var io = require('socket.io-client');
//var ChatClient = require('./chat-client');
var Canvas = require('./canvas');
var global = require('./global');

var playerNameInput = document.getElementById('playerNameInput');
var restart = document.getElementById('restart');
var socket;
var reason;

var debug = function (args) {
    if (console && console.log) {
        console.log(args);
    }
};

if (/Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent)) {
    global.mobile = true;
}

function startGame(type) {
    global.playerName = playerNameInput.value.replace(/(<([^>]+)>)/ig, '').substring(0, 25);
    if (global.playerName === '') {
        global.playerName = randomName();
    }
    global.playerType = type;

    global.screenWidth = window.innerWidth;
    global.screenHeight = window.innerHeight;
    global.followPlayer = false;

    document.getElementById('startMenuWrapper').style.maxHeight = '0px';
    document.getElementById('gameAreaWrapper').style.opacity = 1;
    if (!socket) {
        socket = io({query: "type=" + type});
        setupSocket(socket);
    }
    if (!global.animLoopHandle)
        animloop();
    socket.emit('respawn', {type: type});

    window.canvas.socket = socket;
    global.socket = socket;
}

// Checks if the nick chosen contains valid alphanumeric characters (and underscores).
function validNick() {
    var regex = /^\w*$/;
//    debug('Regex Test', regex.exec(playerNameInput.value));
    return regex.exec(playerNameInput.value) !== null;
}

window.onload = function () {
    var btn = document.getElementById('startButton'),
            btnS = document.getElementById('spectateButton'),
            nickErrorText = document.querySelector('#startMenu .input-error');

    btnS.onclick = function () {
        if (global.mobile) {
            startGame('follower');
        } else {
            startGame('spectator');
        }
    };

    btn.onclick = function () {
        // Checks if the nick is valid.
        if (validNick()) {
            nickErrorText.style.opacity = 0;
            startGame('player');
        } else {
            nickErrorText.style.opacity = 1;
        }
    };

    restart.onclick = function () {
        socket.emit('restart');
    };

    var settingsMenu = document.getElementById('settingsButton');
    var settings = document.getElementById('settings');
    var instructions = document.getElementById('instructions');
    settingsMenu.onclick = function () {
        if (settings.style.maxHeight == '300px') {
            settings.style.maxHeight = '0px';
            setTimeout(function () {
                settings.classList.remove("panel");
            }, 700);
        } else {
            settings.style.maxHeight = '300px';
            settings.classList.add("panel");
        }
    };
    playerNameInput.addEventListener('keypress', function (e) {
        var key = e.which || e.keyCode;
        if (key === global.KEY_ENTER) {
            if (validNick()) {
                nickErrorText.style.opacity = 0;
                startGame('player');
            } else {
                nickErrorText.style.opacity = 1;
            }
        }
    });
};
// TODO: Break out into GameControls.

var foodConfig = {
    border: 0
};
var playerConfig = {
    border: 6,
    textColor: '#FFFFFF',
    textBorder: '#000000',
    textBorderSize: 3,
    defaultSize: 30
};
var player = {
    id: -1,
    x: global.screenWidth / 2,
    y: global.screenHeight / 2,
    screenWidth: global.screenWidth,
    screenHeight: global.screenHeight,
    target: {x: global.screenWidth / 2, y: global.screenHeight / 2}
};
global.player = player;
var leaderboard;
var players = [];
var fishs = [];
var target = {x: 0, y: 0};
global.target = target;
window.canvas = new Canvas();

var visibleBorderSetting = document.getElementById('visBord');
visibleBorderSetting.onchange = function () {
    if (!global.borderDraw) {
        global.borderDraw = true;
    } else {
        global.borderDraw = false;
    }
};
var visibleGridSetting = document.getElementById('visGrid');
visibleGridSetting.onchange = function () {
    if (!global.gridDraw) {
        global.gridDraw = true;
    } else {
        global.gridDraw = false;
    }
};
var c = window.canvas.cv;
var graph = c.getContext('2d');
graph.mozImageSmoothingEnabled = false;
graph.webkitImageSmoothingEnabled = false;
graph.msImageSmoothingEnabled = false;
graph.imageSmoothingEnabled = false;

// socket stuff.
function setupSocket(socket) {
    // Handle ping.
    socket.on('pongcheck', function () {
        var latency = Date.now() - global.startPingTime;
        debug('Latency: ' + latency + 'ms');
//        window.chat.addSystemLine('Ping: ' + latency + 'ms');
    });
    // Handle error.
    socket.on('connect_failed', function () {
        socket.close();
        global.disconnected = true;
    });
    socket.on('disconnect', function () {
        socket.close();
        global.disconnected = true;
    });
    // Handle connection.
    socket.on('welcome', function (playerSettings) {
        player = playerSettings;
        player.name = global.playerName;
        player.screenWidth = global.screenWidth;
        player.screenHeight = global.screenHeight;
        player.target = window.canvas.target;
        global.player = player;
        socket.emit('gotit', player);
        global.enteredGame = true;
        c.focus();
    });

    socket.on('gameStarted', function () {
        global.gameStart = true;
    });

    socket.on('gameAlreadyStarted', function (data) {
        if (data.screen) {
            global.willFollow = true;
            window.setTimeout(function () {
                global.willFollow = false;
            }, 1000);
        }
        global.gameWidth = data.gameWidth;
        global.gameHeight = data.gameHeight;
        global.playerBorder = data.playerBorder;
        global.initialBorder = data.initialBorder;
        global.followPlayer = data.idToFollow;
        global.playerType = "follower";
        resize();
    });

    socket.on('noPlayerToFollow', function (data) {
        global.noPlayerToFollow = true;
        global.enteredGame = false;
        global.gameStart = false;
        window.setTimeout(function () {
            document.getElementById('gameAreaWrapper').style.opacity = 0;
            document.getElementById('startMenuWrapper').style.maxHeight = '1000px';
            restart.style.display = "none";
            global.noPlayerToFollow = false;
            if (global.animLoopHandle) {
                window.cancelAnimationFrame(global.animLoopHandle);
                global.animLoopHandle = undefined;
            }
        }, 1000);
    });

    socket.on('gameSetup', function (data) {
        global.gameWidth = data.gameWidth;
        global.gameHeight = data.gameHeight;
        global.playerBorder = data.playerBorder;
        global.initialBorder = data.initialBorder;
        resize();
    });

    socket.on('leaderboard', function (data) {
        leaderboard = data.leaderboard;
        var status = '<span class="title">Informations générales</span>';
        status += '<br/>';
        status += '<span class="me">' + leaderboard + "</span>";
        //status += '<br />Players: ' + data.players;
        document.getElementById('status').innerHTML = status;
    });

    // Handle movement.
    socket.on('serverTellPlayerMove', function (userData, fishsList) {
        var playerData;
        for (var i = 0; i < userData.length; i++) {
            if (typeof (userData[i].id) == "undefined") {
                playerData = userData[i];
                i = userData.length;
            }
        }
        if (global.playerType != 'spectator') {
            var xoffset = player.x - playerData.x;
            var yoffset = player.y - playerData.y;
            player.x = playerData.x;
            player.y = playerData.y;
            player.hue = playerData.hue;
            player.size = playerData.size;
            player.radius = playerData.radius;
            player.xoffset = isNaN(xoffset) ? 0 : xoffset;
            player.yoffset = isNaN(yoffset) ? 0 : yoffset;
            player.name = playerData.name;
        }
        players = userData;
        fishs = fishsList;
    });
    // Death.
    socket.on('RIP', function () {
        global.enteredGame = false;
        global.gameStart = false;
        global.died = true;
        window.setTimeout(function () {
            global.died = false;
            socket.emit('respawn', {type: "follower"});
        }, 1500);
    });
    // Win
    socket.on('WIN', function () {
        global.enteredGame = false;
        global.gameStart = false;
        global.win = true;
        window.setTimeout(function () {
            document.getElementById('gameAreaWrapper').style.opacity = 0;
            document.getElementById('startMenuWrapper').style.maxHeight = '1000px';
            restart.style.display = "none";
            global.win = false;
            if (global.animLoopHandle) {
                window.cancelAnimationFrame(global.animLoopHandle);
                global.animLoopHandle = undefined;
            }
        }, 1500);
    });
    // End Followers
    socket.on('gameEnded', function () {
        global.enteredGame = false;
        global.gameStart = false;
        window.setTimeout(function () {
            document.getElementById('gameAreaWrapper').style.opacity = 0;
            document.getElementById('startMenuWrapper').style.maxHeight = '1000px';
            restart.style.display = "none";
            if (global.animLoopHandle) {
                window.cancelAnimationFrame(global.animLoopHandle);
                global.animLoopHandle = undefined;
            }
        }, 2500);
    });
    socket.on('kick', function (data) {
        global.enteredGame = false;
        global.gameStart = false;
        reason = data;
        global.kicked = true;
        socket.close();
    });
}

function drawCircle(centerX, centerY, radius, sides) {
    var theta = 0;
    var x = 0;
    var y = 0;
    graph.beginPath();
    for (var i = 0; i < sides; i++) {
        theta = (i / sides) * 2 * Math.PI;
        x = centerX + radius * Math.sin(theta);
        y = centerY + radius * Math.cos(theta);
        graph.lineTo(x, y);
    }

    graph.closePath();
    graph.stroke();
    graph.fill();
}

function drawFish(fish) {
    graph.strokeStyle = 'hsl(' + fish.hue + ', 100%, 45%)';
    graph.fillStyle = 'hsl(' + fish.hue + ', 100%, 50%)';
    graph.lineWidth = fish.strokeWidth;
    drawCircle(fish.x - player.x + global.screenWidth / 2,
            fish.y - player.y + global.screenHeight / 2,
            fish.radius, global.fishsSides);
    graph.drawImage(document.getElementById(fish.image),
            (fish.x - player.x + global.screenWidth / 2) - fish.radius,
            (fish.y - player.y + global.screenHeight / 2) - fish.radius,
            fish.size, fish.size);
}

function drawPlayers() {
    var start = {
        x: player.x - (global.screenWidth / 2),
        y: player.y - (global.screenHeight / 2)
    };
    for (var z = 0; z < players.length; z++) {
        var userCurrent = players[z];
        var x = 0;
        var y = 0;
        var points = 30 + ~~(userCurrent.size / 5);
        var increase = Math.PI * 2 / points;
        graph.strokeStyle = 'hsl(' + userCurrent.hue + ', 100%, 45%)';
        graph.fillStyle = 'hsl(' + userCurrent.hue + ', 100%, 50%)';
        graph.lineWidth = playerConfig.border;
        var xstore = [];
        var ystore = [];
        global.spin += 0.0;
        var circle = {
            x: userCurrent.x - start.x,
            y: userCurrent.y - start.y
        };

        for (var i = 0; i < points; i++) {
            x = userCurrent.radius * Math.cos(global.spin) + circle.x;
            y = userCurrent.radius * Math.sin(global.spin) + circle.y;
            if (typeof (userCurrent.id) == "undefined") {
                x = valueInRange(-userCurrent.x + global.screenWidth / 2,
                        global.gameWidth - userCurrent.x + global.screenWidth / 2, x);
                y = valueInRange(-userCurrent.y + global.screenHeight / 2,
                        global.gameHeight - userCurrent.y + global.screenHeight / 2, y);
            } else {
                x = valueInRange(-userCurrent.x - player.x + global.screenWidth / 2 + (userCurrent.radius / 3),
                        global.gameWidth - userCurrent.x + global.gameWidth - player.x + global.screenWidth / 2 - (userCurrent.radius / 3), x);
                y = valueInRange(-userCurrent.y - player.y + global.screenHeight / 2 + (userCurrent.radius / 3),
                        global.gameHeight - userCurrent.y + global.gameHeight - player.y + global.screenHeight / 2 - (userCurrent.radius / 3), y);
            }
            global.spin += increase;
            xstore[i] = x;
            ystore[i] = y;
        }
        /*if (wiggle >= player.radius/ 3) inc = -1;
         *if (wiggle <= player.radius / -3) inc = +1;
         *wiggle += inc;
         */
        for (i = 0; i < points; ++i) {
            if (i === 0) {
                graph.beginPath();
                graph.moveTo(xstore[i], ystore[i]);
            } else if (i > 0 && i < points - 1) {
                graph.lineTo(xstore[i], ystore[i]);
            } else {
                graph.lineTo(xstore[i], ystore[i]);
                graph.lineTo(xstore[0], ystore[0]);
            }

        }
        graph.lineJoin = 'round';
        graph.lineCap = 'round';
        graph.fill();
        graph.stroke();
        graph.drawImage(document.getElementById(userCurrent.image),
                circle.x - userCurrent.radius,
                circle.y - userCurrent.radius,
                userCurrent.size, userCurrent.size);
        var nameCell = "";
        if (typeof (userCurrent.id) == "undefined")
            nameCell = player.name;
        else
            nameCell = userCurrent.name;
        var fontSize = Math.max(userCurrent.radius / 3, 12);
        graph.lineWidth = playerConfig.textBorderSize;
        graph.fillStyle = playerConfig.textColor;
        graph.strokeStyle = playerConfig.textBorder;
        graph.miterLimit = 1;
        graph.lineJoin = 'round';
        graph.textAlign = 'center';
        graph.textBaseline = 'middle';
        graph.font = 'bold ' + fontSize + 'px sans-serif';
        graph.strokeText(nameCell, circle.x, circle.y + userCurrent.size);
        graph.fillText(nameCell, circle.x, circle.y + userCurrent.size);
    }
}

function valueInRange(min, max, value) {
    return Math.min(max, Math.max(min, value));
}

function randomName() {
    function randomIn(array) {
        return array[Math.floor(Math.random() * -array.length) + array.length];
    }
    var animal = ["Ornithorynque", "Alpaga", "Zebre", "Tatou", "Chat", "Phasme", "Kangourou"];
    var adj = ["fatigue", "douteux", "enterre", "apeure", "decu", "agressif", "joyeux"];
    return randomIn(animal) + "_" + randomIn(adj);
}

function drawgrid() {
    graph.lineWidth = 1;
    graph.strokeStyle = global.lineColor;
    graph.globalAlpha = 0.15;
    graph.beginPath();
    for (var x = global.xoffset - player.x; x < global.screenWidth; x += global.screenHeight / 18) {
        graph.moveTo(x, 0);
        graph.lineTo(x, global.screenHeight);
    }

    for (var y = global.yoffset - player.y; y < global.screenHeight; y += global.screenHeight / 18) {
        graph.moveTo(0, y);
        graph.lineTo(global.screenWidth, y);
    }

    graph.stroke();
    graph.globalAlpha = 1;
}

function drawborder() {
    graph.lineWidth = 1;
    var gameWidth = global.gameWidth - global.playerBorder;
    var gameHeight = global.gameHeight - global.playerBorder;
    var screenWidth = (global.screenWidth / 2 + global.playerBorder);
    var screenHeight = (global.screenHeight / 2 + global.playerBorder);
    // Left-vertical.
    if (player.x <= screenWidth) {
        graph.beginPath();
        graph.moveTo(screenWidth - player.x,
                0 ? player.y > global.screenHeight / 2 : screenHeight - player.y);
        graph.lineTo(screenWidth - player.x,
                gameHeight + global.screenHeight / 2 - player.y);
        graph.strokeStyle = global.lineColor;
        graph.stroke();
    }

// Top-horizontal.
    if (player.y <= screenHeight) {
        graph.beginPath();
        graph.moveTo(0 ? player.x > global.screenWidth / 2 : screenWidth - player.x,
                screenHeight - player.y);
        graph.lineTo(gameWidth + global.screenWidth / 2 - player.x,
                screenHeight - player.y);
        graph.strokeStyle = global.lineColor;
        graph.stroke();
    }

// Right-vertical.
    if (gameWidth - player.x <= global.screenWidth / 2) {
        graph.beginPath();
        graph.moveTo(gameWidth + global.screenWidth / 2 - player.x,
                screenHeight - player.y);
        graph.lineTo(gameWidth + global.screenWidth / 2 - player.x,
                gameHeight + global.screenHeight / 2 - player.y);
        graph.strokeStyle = global.lineColor;
        graph.stroke();
    }

// Bottom-horizontal.
    if (gameHeight - player.y <= global.screenHeight / 2) {
        graph.beginPath();
        graph.moveTo(gameWidth + global.screenWidth / 2 - player.x,
                gameHeight + global.screenHeight / 2 - player.y);
        graph.lineTo(screenWidth - player.x,
                gameHeight + global.screenHeight / 2 - player.y);
        graph.strokeStyle = global.lineColor;
        graph.stroke();
    }
}

function drawInitial() {
    graph.lineWidth = 3;
    var gameWidth = global.gameWidth / 2 + global.initialBorder;
    var gameHeight = global.gameHeight / 2 + global.initialBorder;
    var screenWidth = (global.screenWidth / 2 + ((global.gameWidth / 2) - global.initialBorder));
    var screenHeight = (global.screenHeight / 2 + ((global.gameHeight / 2) - global.initialBorder));
    // Left-vertical.
    if (player.x <= screenWidth) {
        graph.beginPath();
        graph.moveTo(screenWidth - player.x,
                0 ? player.y > global.screenHeight / 2 : screenHeight - player.y);
        graph.lineTo(screenWidth - player.x,
                gameHeight + global.screenHeight / 2 - player.y);
        graph.strokeStyle = global.initialBorderColor;
        graph.stroke();
    }

// Top-horizontal.
    if (player.y <= screenHeight) {
        graph.beginPath();
        graph.moveTo(0 ? player.x > global.screenWidth / 2 : screenWidth - player.x,
                screenHeight - player.y);
        graph.lineTo(gameWidth + global.screenWidth / 2 - player.x,
                screenHeight - player.y);
        graph.strokeStyle = global.initialBorderColor;
        graph.stroke();
    }

// Right-vertical.
    if (gameWidth - player.x <= global.screenWidth / 2) {
        graph.beginPath();
        graph.moveTo(gameWidth + global.screenWidth / 2 - player.x,
                screenHeight - player.y);
        graph.lineTo(gameWidth + global.screenWidth / 2 - player.x,
                gameHeight + global.screenHeight / 2 - player.y);
        graph.strokeStyle = global.initialBorderColor;
        graph.stroke();
    }

// Bottom-horizontal.
    if (gameHeight - player.y <= global.screenHeight / 2) {
        graph.beginPath();
        graph.moveTo(gameWidth + global.screenWidth / 2 - player.x,
                gameHeight + global.screenHeight / 2 - player.y);
        graph.lineTo(screenWidth - player.x,
                gameHeight + global.screenHeight / 2 - player.y);
        graph.strokeStyle = global.initialBorderColor;
        graph.stroke();
    }
}

window.requestAnimFrame = (function () {
    return  window.requestAnimationFrame ||
            window.webkitRequestAnimationFrame ||
            window.mozRequestAnimationFrame ||
            window.msRequestAnimationFrame ||
            function (callback) {
                window.setTimeout(callback, 1000 / 30);
            };
})();

window.cancelAnimFrame = (function (handle) {
    return  window.cancelAnimationFrame ||
            window.mozCancelAnimationFrame;
})();

function animloop() {
    global.animLoopHandle = window.requestAnimFrame(animloop);
    gameLoop();
}

function gameLoop() {
    if (global.died) {
        graph.fillStyle = '#333333';
        graph.fillRect(0, 0, global.screenWidth, global.screenHeight);
        graph.textAlign = 'center';
        graph.fillStyle = '#FFFFFF';
        graph.font = 'bold 16px sans-serif';
        graph.fillText('Vous avez perdu !', global.screenWidth / 2, global.screenHeight / 2);
        graph.fillText('Vous allez suivre un autre joueur', global.screenWidth / 2, global.screenHeight / 2 + 30);
    } else if (global.win) {
        graph.fillStyle = '#333333';
        graph.fillRect(0, 0, global.screenWidth, global.screenHeight);
        graph.textAlign = 'center';
        graph.fillStyle = '#FFFFFF';
        graph.font = 'bold 30px sans-serif';
        graph.fillText('Vous avez gagné !', global.screenWidth / 2, global.screenHeight / 2);
    } else if (global.willFollow) {
        graph.fillStyle = '#333333';
        graph.fillRect(0, 0, global.screenWidth, global.screenHeight);
        graph.textAlign = 'center';
        graph.fillStyle = '#FFFFFF';
        graph.font = 'bold 16px sans-serif';
        graph.fillText('La partie a déjà commencée', global.screenWidth / 2, global.screenHeight / 2);
        graph.fillText('Vous allez suivre un autre joueur', global.screenWidth / 2, global.screenHeight / 2 + 30);
    } else if (global.noPlayerToFollow) {
        graph.fillStyle = '#333333';
        graph.fillRect(0, 0, global.screenWidth, global.screenHeight);
        graph.textAlign = 'center';
        graph.fillStyle = '#FFFFFF';
        graph.font = 'bold 22px sans-serif';
        graph.fillText("Il n'y a aucun joueur", global.screenWidth / 2, global.screenHeight / 2);
        graph.fillText('à observer', global.screenWidth / 2, global.screenHeight / 2 + 30);
    } else if (!global.disconnected) {
        if (global.enteredGame) {
            graph.drawImage(document.getElementById('bg'), (player.x - global.screenWidth / 2), (player.y - global.screenHeight / 2), (global.gameWidth + 1000), (global.gameHeight + 1000), -500, -500, (global.gameWidth + 1000), (global.gameHeight + 1000));
            if (global.gridDraw) {
                drawgrid();
            }
            fishs.forEach(drawFish);
            if (global.borderDraw) {
                drawborder();
                if (global.gameStart === false) {
                    drawInitial();
                }
            }
            drawPlayers();
            socket.emit('0', window.canvas.target); // playerSendTarget "Heartbeat".

        } else {
            graph.fillStyle = '#333333';
            graph.fillRect(0, 0, global.screenWidth, global.screenHeight);
            graph.textAlign = 'center';
            graph.fillStyle = '#FFFFFF';
            graph.font = 'bold 30px sans-serif';
            graph.fillText('Patientez...', global.screenWidth / 2, global.screenHeight / 2);
        }
    } else {
        graph.fillStyle = '#333333';
        graph.fillRect(0, 0, global.screenWidth, global.screenHeight);
        graph.textAlign = 'center';
        graph.fillStyle = '#FFFFFF';
        graph.font = 'bold 30px sans-serif';
//        if (global.kicked) {
//            if (reason !== '') {
//                graph.fillText('You were kicked for:', global.screenWidth / 2, global.screenHeight / 2 - 20);
//                graph.fillText(reason, global.screenWidth / 2, global.screenHeight / 2 + 20);
//            } else {
//                graph.fillText('You were kicked!', global.screenWidth / 2, global.screenHeight / 2);
//            }
//        } else {
        graph.fillText('Connexion perdue !', global.screenWidth / 2, global.screenHeight / 2);
//        }
    }
}

window.addEventListener('resize', resize);
function resize() {
    if (!socket)
        return;
    player.screenWidth = c.width = global.screenWidth = global.playerType != 'spectator' ? window.innerWidth : global.gameWidth;
    player.screenHeight = c.height = global.screenHeight = global.playerType != 'spectator' ? window.innerHeight : global.gameHeight;
    if (global.playerType == 'spectator') {
        player.x = global.gameWidth / 2;
        player.y = global.gameHeight / 2;
        document.getElementById('gameAreaWrapper').style.left = "calc((100% - " + global.gameWidth + "px) / 2)";
    }
    if (global.playerType == "spectator" || global.playerType == "follower") {
        restart.style.display = "block";
    } else {
        restart.style.display = "none";
    }
    socket.emit('windowResized', {screenWidth: global.screenWidth, screenHeight: global.screenHeight, followPlayer: global.followPlayer});
}
