/* jslint bitwise: true, node: true */
'use strict';

var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var SAT = require('sat');
var sql = require("mysql");

// Import game settings.
var c = require('../../config.json');

// Import utilities.
var util = require('./lib/util');

// Call sqlinfo.
var s = c.sqlinfo;

var players = [];
var spectators = [];
var followers = [];
var fishs = [];
var sockets = {};

var timeoutStart;
var nbPlayers = 0;
var leaderboard = "Il n'y a aucun joueur !";
var leaderboardChanged = false;

var V = SAT.Vector;
var C = SAT.Circle;

var gameStart = false;
var gameWon = false;

if (s.host !== "DEFAULT") {
    var pool = sql.createConnection({
        host: s.host,
        user: s.user,
        password: s.password,
        database: s.database
    });

    //log sql errors
    pool.connect(function (err) {
        if (err) {
            console.log(err);
        }
    });
}

var initSizeLog = util.log(c.defaultPlayerSize, c.slowBase);

app.use(express.static(__dirname + '/../client'));

function addFishs(toAdd) {
    while (toAdd--) {
        var size = util.randomInRange(c.fishs.defaultSize.from, c.fishs.defaultSize.to, true);
        var radius = util.sizeToRadius(size);
        var startLocation = util.randomInRange(0, 4);
        var position = util.randomBorder(startLocation, radius);
        var target = util.randomTargetBorder(startLocation, radius);
        var speed = util.randomInRange(c.fishs.defaultSpeed.from, c.fishs.defaultSpeed.to) / 10;
        var img = chooseFishImage(size);
        fishs.push({
            id: ((new Date()).getTime() + '' + fishs.length) >>> 0,
            target: target,
            startLocation: startLocation,
            x: position.x,
            y: position.y,
            radius: radius,
            size: size,
            image: img,
            hue: Math.round(Math.random() * 360),
            strokeWidth: c.fishs.strokeWidth,
            speed: speed
        });
    }
}

function chooseFishImage(size) {
    if (size < 35) {
        return "xsfish" + util.randomInRange(1, c.xsfishs + 1);
    } else if (size < 70) {
        return "smfish" + util.randomInRange(1, c.smfishs + 1);
    } else if (size < 120) {
        return "mdfish" + util.randomInRange(1, c.mdfishs + 1);
    } else {
        return "lgfish" + util.randomInRange(1, c.lgfishs + 1);
    }
}

function movePlayer(player) {
    var target = player.target;
    var speed = player.speed;
    var radius = player.radius;

    var dist = Math.sqrt(Math.pow(target.y, 2) + Math.pow(target.x, 2));
    var deg = Math.atan2(target.y, target.x);

    var deltaX = speed * Math.cos(deg);
    var deltaY = speed * Math.sin(deg);

    if (dist < (50 + radius)) {
        deltaY *= dist / (50 + radius);
        deltaX *= dist / (50 + radius);
    }
    if (!isNaN(deltaY)) {
        player.y += deltaY;
    }
    if (!isNaN(deltaX)) {
        player.x += deltaX;
    }

    if (gameStart || gameWon) {
        var borderCalc = radius / 3 + c.playerBorder;
        if (player.x > c.gameWidth - borderCalc) {
            player.x = c.gameWidth - borderCalc;
        }
        if (player.y > c.gameHeight - borderCalc) {
            player.y = c.gameHeight - borderCalc;
        }
        if (player.x < borderCalc) {
            player.x = borderCalc;
        }
        if (player.y < borderCalc) {
            player.y = borderCalc;
        }
    } else {
        if (player.x > ((c.gameWidth / 2) + c.initialBorder)) {
            player.x = ((c.gameWidth / 2) + c.initialBorder);
        }
        if (player.y > ((c.gameHeight / 2) + c.initialBorder)) {
            player.y = ((c.gameHeight / 2) + c.initialBorder);
        }
        if (player.x < ((c.gameWidth / 2) - c.initialBorder)) {
            player.x = ((c.gameWidth / 2) - c.initialBorder);
        }
        if (player.y < ((c.gameHeight / 2) - c.initialBorder)) {
            player.y = ((c.gameHeight / 2) - c.initialBorder);
        }
    }
}

function moveFish(fish) {
    var deg = Math.atan2(fish.target.y, fish.target.x);
    var deltaY = fish.speed * Math.sin(deg);
    var deltaX = fish.speed * Math.cos(deg);

//    fish.speed -= 0.5;
//    if (fish.speed < 0) {
//        fish.speed = 0;
//    }
    if (!isNaN(deltaY)) {
        fish.y += deltaY;
    }
    if (!isNaN(deltaX)) {
        fish.x += deltaX;
    }

    var borderCalc = 150;
    if (fish.x > c.gameWidth + borderCalc) {
        fishs.splice(util.findIndex(fishs, fish.id), 1);
    }
    if (fish.y > c.gameHeight + borderCalc) {
        fishs.splice(util.findIndex(fishs, fish.id), 1);
    }
    if (fish.x < -borderCalc) {
        fishs.splice(util.findIndex(fishs, fish.id), 1);
    }
    if (fish.y < -borderCalc) {
        fishs.splice(util.findIndex(fishs, fish.id), 1);
    }
}

function balanceFishs() {
    var fishsToAdd = (c.maxFishs - fishs.length) > 5 ? 5 : c.maxFishs - fishs.length;

    if (fishsToAdd > 0) {
        addFishs(fishsToAdd);
    }
}

function choosePlayerImage() {
    return "waste" + util.randomInRange(1, c.wastes + 1);
}

io.on('connection', function (socket) {
    console.log('A user connected!', socket.handshake.query.type);
    var type;
    var currentPlayer = {
        id: socket.id,
        hue: Math.round(Math.random() * 360),
        lastHeartbeat: new Date().getTime()
    };
    socket.on('gotit', function (player) {
        console.log('[INFO] Player ' + player.name + ' connecting!');
        if (util.findIndex(players, player.id) > -1) {
            console.log('[INFO] Player ID is already connected, kicking.');
            socket.disconnect();
        } else if (!util.validNick(player.name)) {
            socket.emit('kick', 'Invalid username.');
            socket.disconnect();
        } else {
            console.log('[INFO] Player ' + player.name + ' connected!');
            sockets[player.id] = socket;
            var radius = util.sizeToRadius(c.defaultPlayerSize);
            var position = util.randomCenterPosition(radius);
            player.x = position.x;
            player.y = position.y;
            player.target.x = 0;
            player.target.y = 0;
            if (type === 'player' && gameStart == false) {
                player.radius = radius;
                player.size = c.defaultPlayerSize;
            } else {
                player.radius = 0;
                player.size = 0;
            }
            player.hue = Math.round(Math.random() * 360);
            player.image = choosePlayerImage();
            currentPlayer = player;
            currentPlayer.lastHeartbeat = new Date().getTime();
//            io.emit('playerJoin', {name: currentPlayer.name});
            if ((gameStart && type == "player") || type == "follower") {
                if (players.length == 0) {
                    socket.emit('noPlayerToFollow');
                } else {
                    currentPlayer.idToFollow = util.randomInRange(0, players.length);
                    socket.emit('gameAlreadyStarted', {
                        gameWidth: c.gameWidth,
                        gameHeight: c.gameHeight,
                        playerBorder: c.playerBorder,
                        initialBorder: c.initialBorder,
                        idToFollow: currentPlayer.idToFollow,
                        screen: (type == "follower") ? false : true
                    });
                    followers.push(currentPlayer);
                    leaderboardChanged = true;
                }
                type = "follower";
            } else {
                socket.emit('gameSetup', {
                    gameWidth: c.gameWidth,
                    gameHeight: c.gameHeight,
                    playerBorder: c.playerBorder,
                    initialBorder: c.initialBorder
                });
                if (type === 'player') {
                    players.push(currentPlayer);
                    console.log('Total players: ' + players.length);
                } else {
                    spectators.push(currentPlayer);
                    leaderboardChanged = true;
                }
            }
        }

    });
    socket.on('pingcheck', function () {
        socket.emit('pongcheck');
    });
    socket.on('restart', function() {
        socket.emit('gameEnded');
    });
    socket.on('windowResized', function (data) {
        currentPlayer.screenWidth = data.screenWidth;
        currentPlayer.screenHeight = data.screenHeight;
        currentPlayer.followPlayer = data.followPlayer;
        if (currentPlayer.followPlayer !== false) {
            currentPlayer.type = "follower";
        }
    });
    socket.on('respawn', function (data) {
        if (util.findIndex(players, currentPlayer.id) > -1) {
            players.splice(util.findIndex(players, currentPlayer.id), 1);
            checkFollowers();
        }
        if (util.findIndex(spectators, currentPlayer.id) > -1) {
            spectators.splice(util.findIndex(spectators, currentPlayer.id), 1);
        }
        if (util.findIndex(followers, currentPlayer.id) > -1) {
            followers.splice(util.findIndex(followers, currentPlayer.id), 1);
        }
        type = data.type;
        var position = util.centerPosition();
        var size = 0;
        var radius = 0;

        if (type === 'player') {
            radius = util.sizeToRadius(c.defaultPlayerSize);
            size = c.defaultPlayerSize;
        }

        currentPlayer.x = position.x;
        currentPlayer.y = position.y;
        currentPlayer.radius = radius;
        currentPlayer.size = size;
        currentPlayer.type = type;
        currentPlayer.target = {
            x: 0,
            y: 0
        };
        socket.emit('welcome', currentPlayer);
        console.log('[INFO] Player ' + currentPlayer.name + ' respawned!');
    });
    socket.on('disconnect', function () {
        if (util.findIndex(players, currentPlayer.id) > -1) {
            players.splice(util.findIndex(players, currentPlayer.id), 1);
            checkFollowers();
        }
        if (util.findIndex(spectators, currentPlayer.id) > -1) {
            spectators.splice(util.findIndex(spectators, currentPlayer.id), 1);
        }
        if (util.findIndex(followers, currentPlayer.id) > -1) {
            followers.splice(util.findIndex(followers, currentPlayer.id), 1);
        }
        console.log('[INFO] User ' + currentPlayer.name + ' disconnected!');
//        socket.broadcast.emit('playerDisconnect', {name: currentPlayer.name});
    });
    // Heartbeat function, update everytime.
    socket.on('0', function (target) {
        currentPlayer.lastHeartbeat = new Date().getTime();
        if (target.x !== currentPlayer.x || target.y !== currentPlayer.y) {
            currentPlayer.target = target;
        }
    });
});

function tickPlayer(currentPlayer) {
    function funcCollide(f) {
        return SAT.testCircleCircle(new C(new V(f.x, f.y), f.radius), playerCircle);
    }
    if (currentPlayer.lastHeartbeat < new Date().getTime() - c.maxHeartbeatInterval) {
        sockets[currentPlayer.id].emit('kick', 'Aucune activité depuis ' + (c.maxHeartbeatInterval / 1000) + ' secondes. Vous avez été déconnecté.');
        sockets[currentPlayer.id].disconnect();
    }

    movePlayer(currentPlayer);

    var playerCircle = new C(
            new V(currentPlayer.x, currentPlayer.y),
            currentPlayer.radius
            );
    var fishCollision = fishs.map(funcCollide)
            .reduce(function (a, b, c) {
                return b ? a.concat(c) : a;
            }, []);
    if (fishCollision > 0 && c.invincibleMode === false && gameWon == false) {
        console.log('[DEBUG] Killing player: ' + currentPlayer.name);
        players.splice(util.findIndex(players, currentPlayer.id), 1);
        sockets[currentPlayer.id].emit('RIP');
        if (players.length == 0) {
            setTimeout(function () {
                sockets[currentPlayer.id].emit('gameEnded');
            }, 500);
        }
        checkFollowers();
        fishs.splice(fishCollision, 1);
    }

    if (typeof (currentPlayer.speed) == "undefined") {
        currentPlayer.speed = 4;
    }
    playerCircle.r = currentPlayer.radius;
}

function checkFollowers() {
    if (players.length == 0) {
        for (let i = 0; i < followers.length; i++) {
            sockets[followers[i].id].emit('gameEnded');
        }
        followers = [];
    } else {
        for (let i = 0; i < followers.length; i++) {
            if (followers[i].idToFollow >= players.length) {
                followers[i].idToFollow = util.randomInRange(0, players.length);
            }
        }
    }
}

function moveloop() {
    for (var i = 0; i < players.length; i++) {
        tickPlayer(players[i]);
    }
    if (gameStart) {
        for (i = 0; i < fishs.length; i++) {
            if (fishs[i].speed > 0)
                moveFish(fishs[i]);
        }
    }
}

function gameloop() {
    /* Leaderboard et déroulement de la partie */
    var nbPlayersNow = players.length;
    if (nbPlayersNow != nbPlayers) {
        nbPlayers = nbPlayersNow;
        leaderboardChanged = true;
        if (nbPlayers == 0) {
            if (gameStart) {
                leaderboard = "Égalité !";
                setTimeout(function () {
                    for (let i = 0; i < followers.length; i++) {
                        sockets[followers[i].id].emit('gameEnded');
                    }
                    followers = [];
                    fishs = [];
                    gameStart = false;
                }, 2500);
            } else {
                leaderboard = "Il n'y a aucun joueur !";
                clearTimeout(timeoutStart);
            }
        } else if (nbPlayers == 1) {
            if (gameStart) {
                leaderboard = "Nous avons un gagnant !<br/>Bravo à " + players[0].name + " !";
                gameWon = true;
                setTimeout(function () {
                    console.log('[DEBUG] User win: ' + players[0].name);
                    sockets[players[0].id].emit('WIN');
                    players = [];
                    for (let i = 0; i < followers.length; i++) {
                        sockets[followers[i].id].emit('gameEnded');
                    }
                    followers = [];
                    fishs = [];
                    gameWon = false;
                    gameStart = false;
                }, 2500);
            } else {
                leaderboard = "Il y a 1 joueur connecté<br/>En attente de plus de joueurs";
                clearTimeout(timeoutStart);
            }
        } else if (nbPlayers == 2 && gameStart == false) {
            clearTimeout(timeoutStart);
            timeoutStart = setTimeout(function () {
                gameStart = true;
                leaderboard = "Il reste " + nbPlayers + " joueurs";
                leaderboardChanged = true;
                for (let i in sockets) {
                    sockets[i].emit('gameStarted');
                }
                clearTimeout(timeoutStart);
            }, (c.startTimer * 1000));
            leaderboard = "Il y a 2 joueurs connectés<br/>Il reste " + printTimeLeft(timeoutStart) + " avant le début.";
        } else {
            if (gameStart) {
                leaderboard = "Il reste " + nbPlayers + " joueurs";
            } else {
                if (nbPlayers == 100) {
                    gameStart = true;
                    leaderboard = "Il reste " + nbPlayers + " joueurs";
                    leaderboardChanged = true;
                    for (let i in sockets) {
                        sockets[i].emit('gameStarted');
                    }
                    clearTimeout(timeoutStart);
                } else {
                    if (timeoutStart._idleTimeout == -1) {
                        timeoutStart = setTimeout(function () {
                            gameStart = true;
                            leaderboard = "Il reste " + nbPlayers + " joueurs";
                            leaderboardChanged = true;
                            for (let i in sockets) {
                                sockets[i].emit('gameStarted');
                            }
                            clearTimeout(timeoutStart);
                        }, (c.startTimer * 1000));
                    }
                    leaderboard = "Il y a " + nbPlayers + " joueurs connectés<br/>Il reste " + printTimeLeft(timeoutStart) + " avant le début.";
                }
            }
        }
    } else {
        if (gameStart) {
            balanceFishs();
        } else {
            if (nbPlayers >= 2) {
                leaderboardChanged = true;
                leaderboard = "Il y a " + nbPlayers + " joueurs connectés<br/>Il reste " + printTimeLeft(timeoutStart) + " avant le début.";
                console.log("[INFO] Game start in " + printTimeLeft(timeoutStart));
            }
        }
    }
    //        for (i = 0; i < users.length; i++) {
//                if (users[i].size * (1 - (c.sizeLossRate / 1000)) > c.defaultPlayerSize && users[i].size > c.minSizeLoss) {
//                    var sizeLoss = users[i].size * (1 - (c.sizeLossRate / 1000));
//                    users[i].size -= users[i].size - sizeLoss;
//                    users[i].size = sizeLoss;
//                }
//        }
}

function printTimeLeft(timeout) {
    var timeLeft = getTimeLeft(timeout);
    var minutsLeft = Math.trunc(timeLeft / 60);
    var secondsLeft = timeLeft % 60;
    return ("0" + minutsLeft).slice(-2) + ":" + ("0" + secondsLeft).slice(-2);
}

function getTimeLeft(timeout) {
    return Math.ceil(((timeout._idleStart + timeout._idleTimeout) / 1000) - process.uptime());
}

function sendUpdates() {
    players.forEach(function (u) {
        var visibleFishs = fishs
                .map(function (f) {
                    if (f.x > u.x - u.screenWidth / 2 - f.radius &&
                            f.x < u.x + u.screenWidth / 2 + f.radius &&
                            f.y > u.y - u.screenHeight / 2 - f.radius &&
                            f.y < u.y + u.screenHeight / 2 + f.radius) {
                        return f;
                    }
                })
                .filter(function (f) {
                    return f;
                });
        var visiblePlayers = players
                .map(function (f) {
                    if (f.x + f.radius > u.x - u.screenWidth / 2 - 20 &&
                            f.x - f.radius < u.x + u.screenWidth / 2 + 20 &&
                            f.y + f.radius > u.y - u.screenHeight / 2 - 20 &&
                            f.y - f.radius < u.y + u.screenHeight / 2 + 20) {
                        if (f.id !== u.id) {
                            return {
                                id: f.id,
                                x: f.x,
                                y: f.y,
                                radius: f.radius,
                                size: Math.round(f.size),
                                hue: f.hue,
                                image: f.image,
                                name: f.name
                            };
                        } else {
                            //console.log("Nombre: " + f.name + " est un utilisateur");
                            return {
                                x: f.x,
                                y: f.y,
                                radius: f.radius,
                                size: Math.round(f.size),
                                hue: f.hue,
                                image: f.image,
                                name: f.name
                            };
                        }
                    }

                })
                .filter(function (f) {
                    return f;
                });
        sockets[u.id].emit('serverTellPlayerMove', visiblePlayers, visibleFishs);
        if (leaderboardChanged) {
            sockets[u.id].emit('leaderboard', {
                players: players.length,
                leaderboard: leaderboard
            });
        }
    });
    spectators.forEach(function (u) {
// center the view if x/y is undefined, this will happen for spectators
        u.x = c.gameWidth / 2;
        u.y = c.gameHeight / 2;
        var visibleFishs = fishs
                .map(function (f) {
                    if (f.x > u.x - u.screenWidth / 2 - f.radius &&
                            f.x < u.x + u.screenWidth / 2 + f.radius &&
                            f.y > u.y - u.screenHeight / 2 - f.radius &&
                            f.y < u.y + u.screenHeight / 2 + f.radius) {
                        return f;
                    }
                })
                .filter(function (f) {
                    return f;
                });
        var visiblePlayers = players
                .map(function (f) {
                    if (f.x + f.radius > u.x - u.screenWidth / 2 - 20 &&
                            f.x - f.radius < u.x + u.screenWidth / 2 + 20 &&
                            f.y + f.radius > u.y - u.screenHeight / 2 - 20 &&
                            f.y - f.radius < u.y + u.screenHeight / 2 + 20) {
                        return {
                            id: f.id,
                            x: f.x,
                            y: f.y,
                            radius: f.radius,
                            size: Math.round(f.size),
                            hue: f.hue,
                            image: f.image,
                            name: f.name
                        };
                    }
                })
                .filter(function (f) {
                    return f;
                });
        sockets[u.id].emit('serverTellPlayerMove', visiblePlayers, visibleFishs);
        if (leaderboardChanged) {
            sockets[u.id].emit('leaderboard', {
                players: players.length,
                leaderboard: leaderboard
            });
        }
    });
    checkFollowers();
    followers.forEach(function (follower) {
        var u = players[follower.idToFollow];
        var visibleFishs = fishs
                .map(function (f) {
                    if (f.x > u.x - u.screenWidth / 2 - f.radius &&
                            f.x < u.x + u.screenWidth / 2 + f.radius &&
                            f.y > u.y - u.screenHeight / 2 - f.radius &&
                            f.y < u.y + u.screenHeight / 2 + f.radius) {
                        return f;
                    }
                })
                .filter(function (f) {
                    return f;
                });
        var visiblePlayers = players
                .map(function (f) {
                    if (f.x + f.radius > u.x - u.screenWidth / 2 - 20 &&
                            f.x - f.radius < u.x + u.screenWidth / 2 + 20 &&
                            f.y + f.radius > u.y - u.screenHeight / 2 - 20 &&
                            f.y - f.radius < u.y + u.screenHeight / 2 + 20) {
                        if (f.id !== u.id) {
                            return {
                                id: f.id,
                                x: f.x,
                                y: f.y,
                                radius: f.radius,
                                size: Math.round(f.size),
                                hue: f.hue,
                                image: f.image,
                                name: f.name
                            };
                        } else {
                            //console.log("Nombre: " + f.name + " est un utilisateur");
                            return {
                                x: f.x,
                                y: f.y,
                                radius: f.radius,
                                size: Math.round(f.size),
                                hue: f.hue,
                                image: f.image,
                                name: f.name
                            };
                        }
                    }
                })
                .filter(function (f) {
                    return f;
                });
        sockets[follower.id].emit('serverTellPlayerMove', visiblePlayers, visibleFishs);
        if (leaderboardChanged) {
            var lb = leaderboard;
            if (players.length > 1) {
                lb = lb + "<br/><br/>Vous suivez le joueur " + u.name;
            }
            sockets[follower.id].emit('leaderboard', {
                players: players.length,
                leaderboard: lb
            });
        }
    });
    leaderboardChanged = false;
}

setInterval(moveloop, 1000 / 60);
setInterval(gameloop, 1000);
setInterval(sendUpdates, 1000 / c.networkUpdateFactor);

// Don't touch, IP configurations.
var ipaddress = process.env.OPENSHIFT_NODEJS_IP || process.env.IP || c.host;
var serverport = process.env.OPENSHIFT_NODEJS_PORT || process.env.PORT || c.port;
http.listen(serverport, ipaddress, function () {
    console.log('[DEBUG] Listening on ' + ipaddress + ':' + serverport);
});
