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

// Import quadtree.
var quadtree = require('simple-quadtree');

// Call sqlinfo.
var s = c.sqlinfo;

var tree = quadtree(0, 0, c.gameWidth, c.gameHeight);

var users = [];
var fishs = [];
var sockets = {};

var leaderboard = [];
var leaderboardChanged = false;

var V = SAT.Vector;
var C = SAT.Circle;

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

var initMassLog = util.log(c.defaultPlayerMass, c.slowBase);

app.use(express.static(__dirname + '/../client'));

function addFishs(toAdd) {
    while (toAdd--) {
        var mass = util.randomInRange(c.fishs.defaultMass.from, c.fishs.defaultMass.to, true);
        var radius = util.massToRadius(mass);
        var position = util.randomPosition(radius);
        fishs.push({
            id: ((new Date()).getTime() + '' + fishs.length) >>> 0,
            target: {
                x: 0,
                y: 0
            },
            x: position.x,
            y: position.y,
            radius: radius,
            mass: mass,
            fill: c.fishs.fill,
            stroke: c.fishs.stroke,
            strokeWidth: c.fishs.strokeWidth,
            speed: 10
        });
    }
}

function movePlayer(player) {
    var x = 0, y = 0;
    for (var i = 0; i < player.cells.length; i++)
    {
        var target = {
            x: player.x - player.cells[i].x + player.target.x,
            y: player.y - player.cells[i].y + player.target.y
        };
        var dist = Math.sqrt(Math.pow(target.y, 2) + Math.pow(target.x, 2));
        var deg = Math.atan2(target.y, target.x);
        var slowDown = 1;
        if (player.cells[i].speed <= 6.25) {
            slowDown = util.log(player.cells[i].mass, c.slowBase) - initMassLog + 1;
        }

        var deltaY = player.cells[i].speed * Math.sin(deg) / slowDown;
        var deltaX = player.cells[i].speed * Math.cos(deg) / slowDown;

        if (player.cells[i].speed > 6.25) {
            player.cells[i].speed -= 0.5;
        }
        if (dist < (50 + player.cells[i].radius)) {
            deltaY *= dist / (50 + player.cells[i].radius);
            deltaX *= dist / (50 + player.cells[i].radius);
        }
        if (!isNaN(deltaY)) {
            player.cells[i].y += deltaY;
        }
        if (!isNaN(deltaX)) {
            player.cells[i].x += deltaX;
        }
        // Find best solution.
        for (var j = 0; j < player.cells.length; j++) {
            if (j != i && player.cells[i] !== undefined) {
                var distance = Math.sqrt(Math.pow(player.cells[j].y - player.cells[i].y, 2) + Math.pow(player.cells[j].x - player.cells[i].x, 2));
                var radiusTotal = (player.cells[i].radius + player.cells[j].radius);
                if (distance < radiusTotal) {
                    if (player.lastSplit > new Date().getTime() - 1000 * c.mergeTimer) {
                        if (player.cells[i].x < player.cells[j].x) {
                            player.cells[i].x--;
                        } else if (player.cells[i].x > player.cells[j].x) {
                            player.cells[i].x++;
                        }
                        if (player.cells[i].y < player.cells[j].y) {
                            player.cells[i].y--;
                        } else if ((player.cells[i].y > player.cells[j].y)) {
                            player.cells[i].y++;
                        }
                    } else if (distance < radiusTotal / 1.75) {
                        player.cells[i].mass += player.cells[j].mass;
                        player.cells[i].radius = util.massToRadius(player.cells[i].mass);
                        player.cells.splice(j, 1);
                    }
                }
            }
        }
        if (player.cells.length > i) {
            var borderCalc = player.cells[i].radius / 3;
            if (player.cells[i].x > c.gameWidth - borderCalc) {
                player.cells[i].x = c.gameWidth - borderCalc;
            }
            if (player.cells[i].y > c.gameHeight - borderCalc) {
                player.cells[i].y = c.gameHeight - borderCalc;
            }
            if (player.cells[i].x < borderCalc) {
                player.cells[i].x = borderCalc;
            }
            if (player.cells[i].y < borderCalc) {
                player.cells[i].y = borderCalc;
            }
            x += player.cells[i].x;
            y += player.cells[i].y;
        }
    }
    player.x = x / player.cells.length;
    player.y = y / player.cells.length;
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

    var borderCalc = fish.radius + 5;

    if (fish.x > c.gameWidth - borderCalc) {
        fish.x = c.gameWidth - borderCalc;
    }
    if (fish.y > c.gameHeight - borderCalc) {
        fish.y = c.gameHeight - borderCalc;
    }
    if (fish.x < borderCalc) {
        fish.x = borderCalc;
    }
    if (fish.y < borderCalc) {
        fish.y = borderCalc;
    }
}

function balanceFishs() {
    var fishsToAdd = c.maxFishs - fishs.length;

    if (fishsToAdd > 0) {
        addFishs(fishsToAdd);
    }
}

io.on('connection', function (socket) {
    console.log('A user connected!', socket.handshake.query.type);

    var type = socket.handshake.query.type;
    var radius = util.massToRadius(c.defaultPlayerMass);
    var position = util.centerPosition(radius);

    var cells = [];
    var massTotal = 0;
    if (type === 'player') {
        cells = [{
                mass: c.defaultPlayerMass,
                x: position.x,
                y: position.y,
                radius: radius
            }];
        massTotal = c.defaultPlayerMass;
    }

    var currentPlayer = {
        id: socket.id,
        x: position.x,
        y: position.y,
        w: c.defaultPlayerMass,
        h: c.defaultPlayerMass,
        cells: cells,
        massTotal: massTotal,
        hue: Math.round(Math.random() * 360),
        type: type,
        lastHeartbeat: new Date().getTime(),
        target: {
            x: 0,
            y: 0
        }
    };

    socket.on('gotit', function (player) {
        console.log('[INFO] Player ' + player.name + ' connecting!');

        if (util.findIndex(users, player.id) > -1) {
            console.log('[INFO] Player ID is already connected, kicking.');
            socket.disconnect();
        } else if (!util.validNick(player.name)) {
            socket.emit('kick', 'Invalid username.');
            socket.disconnect();
        } else {
            console.log('[INFO] Player ' + player.name + ' connected!');
            sockets[player.id] = socket;

            var radius = util.massToRadius(c.defaultPlayerMass);
            var position = util.centerPosition(radius);

            player.x = position.x;
            player.y = position.y;
            player.target.x = 0;
            player.target.y = 0;
            if (type === 'player') {
                player.cells = [{
                        mass: c.defaultPlayerMass,
                        x: position.x,
                        y: position.y,
                        radius: radius
                    }];
                player.massTotal = c.defaultPlayerMass;
            } else {
                player.cells = [];
                player.massTotal = 0;
            }
            player.hue = Math.round(Math.random() * 360);
            currentPlayer = player;
            currentPlayer.lastHeartbeat = new Date().getTime();
            users.push(currentPlayer);

            io.emit('playerJoin', {name: currentPlayer.name});

            socket.emit('gameSetup', {
                gameWidth: c.gameWidth,
                gameHeight: c.gameHeight
            });
            console.log('Total players: ' + users.length);
        }

    });

    socket.on('pingcheck', function () {
        socket.emit('pongcheck');
    });

    socket.on('windowResized', function (data) {
        currentPlayer.screenWidth = data.screenWidth;
        currentPlayer.screenHeight = data.screenHeight;
    });

    socket.on('respawn', function () {
        if (util.findIndex(users, currentPlayer.id) > -1)
            users.splice(util.findIndex(users, currentPlayer.id), 1);
        socket.emit('welcome', currentPlayer);
        console.log('[INFO] User ' + currentPlayer.name + ' respawned!');
    });

    socket.on('disconnect', function () {
        if (util.findIndex(users, currentPlayer.id) > -1)
            users.splice(util.findIndex(users, currentPlayer.id), 1);
        console.log('[INFO] User ' + currentPlayer.name + ' disconnected!');

        socket.broadcast.emit('playerDisconnect', {name: currentPlayer.name});
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
    if (currentPlayer.lastHeartbeat < new Date().getTime() - c.maxHeartbeatInterval) {
        sockets[currentPlayer.id].emit('kick', 'Aucune activité depuis ' + (c.maxHeartbeatInterval / 1000) + ' secondes. Vous avez été déconnecté.');
        sockets[currentPlayer.id].disconnect();
    }

    function funcFood(f) {
        return SAT.pointInCircle(new V(f.x, f.y), playerCircle);
    }

    movePlayer(currentPlayer);

//    function check(user) {
//        for (var i = 0; i < user.cells.length; i++) {
//            if (user.cells[i].mass > 10 && user.id !== currentPlayer.id) {
//                var response = new SAT.Response();
//                var collided = SAT.testCircleCircle(playerCircle,
//                        new C(new V(user.cells[i].x, user.cells[i].y), user.cells[i].radius),
//                        response);
//                if (collided) {
//                    response.aUser = currentCell;
//                    response.bUser = {
//                        id: user.id,
//                        name: user.name,
//                        x: user.cells[i].x,
//                        y: user.cells[i].y,
//                        num: i,
//                        mass: user.cells[i].mass
//                    };
//                    playerCollisions.push(response);
//                }
//            }
//        }
//        return true;
//    }
//
//    function collisionCheck(collision) {
//        if (collision.aUser.mass > collision.bUser.mass * 1.1 && collision.aUser.radius > Math.sqrt(Math.pow(collision.aUser.x - collision.bUser.x, 2) + Math.pow(collision.aUser.y - collision.bUser.y, 2)) * 1.75) {
//            console.log('[DEBUG] Killing user: ' + collision.bUser.id);
//            console.log('[DEBUG] Collision info:');
//            console.log(collision);
//
//            var numUser = util.findIndex(users, collision.bUser.id);
//            if (numUser > -1) {
//                if (users[numUser].cells.length > 1) {
//                    users[numUser].massTotal -= collision.bUser.mass;
//                    users[numUser].cells.splice(collision.bUser.num, 1);
//                } else {
//                    users.splice(numUser, 1);
//                    io.emit('playerDied', {name: collision.bUser.name});
//                    sockets[collision.bUser.id].emit('RIP');
//                }
//            }
//            currentPlayer.massTotal += collision.bUser.mass;
//            collision.aUser.mass += collision.bUser.mass;
//        }
//    }

    for (var z = 0; z < currentPlayer.cells.length; z++) {
        var currentCell = currentPlayer.cells[z];
        var playerCircle = new C(
                new V(currentCell.x, currentCell.y),
                currentCell.radius
                );

        var fishCollision = fishs.map(funcFood)
                .reduce(function (a, b, c) {
                    return b ? a.concat(c) : a;
                }, []);

        if (fishCollision > 0) {
            users.splice(currentPlayer.id, 1);
            io.emit('playerDied', {name: currentPlayer.name});
            sockets[currentPlayer.id].emit('RIP');
            fishs.splice(fishCollision, 1);
        }

        if (typeof (currentCell.speed) == "undefined") {
            currentCell.speed = 6.25;
        }
        playerCircle.r = currentCell.radius;

        tree.clear();
        users.forEach(tree.put);
//        var playerCollisions = [];

//        var otherUsers = tree.get(currentPlayer, check);

//        playerCollisions.forEach(collisionCheck);
    }
}

function moveloop() {
    for (var i = 0; i < users.length; i++) {
        tickPlayer(users[i]);
    }
    for (i = 0; i < fishs.length; i++) {
        if (fishs[i].speed > 0)
            moveFish(fishs[i]);
    }
}

function gameloop() {
    if (users.length > 0) {
        if (isNaN(leaderboard) || leaderboard.length !== users.length) {
            leaderboard = users.length;
            leaderboardChanged = true;
        }
//        for (i = 0; i < users.length; i++) {
//            for (var z = 0; z < users[i].cells.length; z++) {
//                if (users[i].cells[z].mass * (1 - (c.massLossRate / 1000)) > c.defaultPlayerMass && users[i].massTotal > c.minMassLoss) {
//                    var massLoss = users[i].cells[z].mass * (1 - (c.massLossRate / 1000));
//                    users[i].massTotal -= users[i].cells[z].mass - massLoss;
//                    users[i].cells[z].mass = massLoss;
//                }
//            }
//        }
    }
    balanceFishs();
}

function sendUpdates() {
    users.forEach(function (u) {
        // center the view if x/y is undefined, this will happen for spectators
        u.x = u.x || c.gameWidth / 2;
        u.y = u.y || c.gameHeight / 2;

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

        var visibleCells = users
                .map(function (f) {
                    for (var z = 0; z < f.cells.length; z++)
                    {
                        if (f.cells[z].x + f.cells[z].radius > u.x - u.screenWidth / 2 - 20 &&
                                f.cells[z].x - f.cells[z].radius < u.x + u.screenWidth / 2 + 20 &&
                                f.cells[z].y + f.cells[z].radius > u.y - u.screenHeight / 2 - 20 &&
                                f.cells[z].y - f.cells[z].radius < u.y + u.screenHeight / 2 + 20) {
                            z = f.cells.lenth;
                            if (f.id !== u.id) {
                                return {
                                    id: f.id,
                                    x: f.x,
                                    y: f.y,
                                    cells: f.cells,
                                    massTotal: Math.round(f.massTotal),
                                    hue: f.hue,
                                    name: f.name
                                };
                            } else {
                                //console.log("Nombre: " + f.name + " Es Usuario");
                                return {
                                    x: f.x,
                                    y: f.y,
                                    cells: f.cells,
                                    massTotal: Math.round(f.massTotal),
                                    hue: f.hue,
                                };
                            }
                        }
                    }
                })
                .filter(function (f) {
                    return f;
                });

        sockets[u.id].emit('serverTellPlayerMove', visibleCells, visibleFishs);
        if (leaderboardChanged) {
            sockets[u.id].emit('leaderboard', {
                players: users.length,
                leaderboard: leaderboard
            });
        }
    });
    leaderboardChanged = false;
}

setInterval(moveloop, 1000 / 150);
setInterval(gameloop, 1000);
setInterval(sendUpdates, 1000 / c.networkUpdateFactor);

// Don't touch, IP configurations.
var ipaddress = process.env.OPENSHIFT_NODEJS_IP || process.env.IP || c.host;
var serverport = process.env.OPENSHIFT_NODEJS_PORT || process.env.PORT || c.port;
http.listen(serverport, ipaddress, function () {
    console.log('[DEBUG] Listening on ' + ipaddress + ':' + serverport);
});
