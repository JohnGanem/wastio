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
var nbFishs = 0;
var sockets = {};

var leaderboard;
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

var initSizeLog = util.log(c.defaultPlayerSize, c.slowBase);

app.use(express.static(__dirname + '/../client'));

function addFishs(toAdd) {
    while (toAdd--) {
        var size = util.randomInRange(c.fishs.defaultSize.from, c.fishs.defaultSize.to, true);
        var radius = util.sizeToRadius(size);
        var startLocation = util.randomInRange(0, 4);
        var position = util.randomBorder(startLocation, radius);
        var target = util.randomTargetBorder(startLocation, position, radius);
        var speed = util.randomInRange(1, 40) / 10;
        fishs.push({
            id: ((new Date()).getTime() + '' + fishs.length) >>> 0,
            target: target,
            startLocation: startLocation,
            x: position.x,
            y: position.y,
            radius: radius,
            size: size,
            fill: c.fishs.fill,
            stroke: c.fishs.stroke,
            strokeWidth: c.fishs.strokeWidth,
            speed: speed
        });
        nbFishs++;
    }
}

function movePlayer(player) {
    var target = player.target;
    var speed = player.speed;
    var size = player.size;
    var radius = player.radius;

    var dist = Math.sqrt(Math.pow(target.y, 2) + Math.pow(target.x, 2));
    var deg = Math.atan2(target.y, target.x);
    var slowDown = 1;
    if (speed <= 6.25) {
        slowDown = util.log(size, c.slowBase) - initSizeLog + 1;
    }

    var deltaY = speed * Math.sin(deg) / slowDown;
    var deltaX = speed * Math.cos(deg) / slowDown;

    if (speed > 6.25) {
        player.speed -= 0.5;
    }
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
    var borderCalc = radius / 3 + 150;
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

    var borderCalc = 50;
    if (fish.x > c.gameWidth + borderCalc) {
        fishs.splice(util.findIndex(fishs, fish.id), 1);
        nbFishs--;
    }
    if (fish.y > c.gameHeight + borderCalc) {
        fishs.splice(util.findIndex(fishs, fish.id), 1);
        nbFishs--;
    }
    if (fish.x < -borderCalc) {
        fishs.splice(util.findIndex(fishs, fish.id), 1);
        nbFishs--;
    }
    if (fish.y < -borderCalc) {
        fishs.splice(util.findIndex(fishs, fish.id), 1);
        nbFishs--;
    }
}

function balanceFishs() {
    var fishsToAdd = (c.maxFishs - nbFishs) > 5 ? 5 : c.maxFishs - nbFishs;

    if (fishsToAdd > 0) {
        addFishs(fishsToAdd);
    }
}

io.on('connection', function (socket) {
    console.log('A user connected!', socket.handshake.query.type);
    var type = socket.handshake.query.type;
    var position = util.centerPosition(radius);
    var size = 0;
    var radius = 0;

    if (type === 'player') {
        radius = util.sizeToRadius(c.defaultPlayerSize);
        size = c.defaultPlayerSize;
    }

    var currentPlayer = {
        id: socket.id,
        x: position.x,
        y: position.y,
        w: c.defaultPlayerSize,
        h: c.defaultPlayerSize,
        radius: radius,
        size: size,
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
            var radius = util.sizeToRadius(c.defaultPlayerSize);
            var position = util.centerPosition(radius);
            player.x = position.x;
            player.y = position.y;
            player.target.x = 0;
            player.target.y = 0;
            if (type === 'player') {
                player.radius = radius;
                player.size = c.defaultPlayerSize;
            } else {
                player.radius = 0;
                player.size = 0;
            }
            player.hue = Math.round(Math.random() * 360);
            currentPlayer = player;
            currentPlayer.lastHeartbeat = new Date().getTime();
            users.push(currentPlayer);
//            io.emit('playerJoin', {name: currentPlayer.name});
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
    if (currentPlayer.type == 'player') {
        if (currentPlayer.lastHeartbeat < new Date().getTime() - c.maxHeartbeatInterval) {
            sockets[currentPlayer.id].emit('kick', 'Aucune activité depuis ' + (c.maxHeartbeatInterval / 1000) + ' secondes. Vous avez été déconnecté.');
            sockets[currentPlayer.id].disconnect();
        }

        movePlayer(currentPlayer);
//    function check(user) {
//            if (user.size > 10 && user.id !== currentPlayer.id) {
//                var response = new SAT.Response();
//                var collided = SAT.testCircleCircle(playerCircle,
//                        new C(new V(user.x, user.y), user.radius),
//                        response);
//                if (collided) {
//                    response.aUser = currentPlayer;
//                    response.bUser = {
//                        id: user.id,
//                        name: user.name,
//                        x: user.x,
//                        y: user.y,
//                        num: i,
//                        size: user.size
//                    };
//                    playerCollisions.push(response);
//                }
//            }
//        return true;
//    }
//
//    function collisionCheck(collision) {
//        if (collision.aUser.size > collision.bUser.size * 1.1 && collision.aUser.radius > Math.sqrt(Math.pow(collision.aUser.x - collision.bUser.x, 2) + Math.pow(collision.aUser.y - collision.bUser.y, 2)) * 1.75) {
//            console.log('[DEBUG] Killing user: ' + collision.bUser.id);
//            console.log('[DEBUG] Collision info:');
//            console.log(collision);
//
//            var numUser = util.findIndex(users, collision.bUser.id);
//            if (numUser > -1) {
//                    users.splice(numUser, 1);
//                    io.emit('playerDied', {name: collision.bUser.name});
//                    sockets[collision.bUser.id].emit('RIP');
//            }
//            currentPlayer.size += collision.bUser.size;
//            collision.aUser.size += collision.bUser.size;
//        }
//    }

        var playerCircle = new C(
                new V(currentPlayer.x, currentPlayer.y),
                currentPlayer.radius
                );
        var fishCollision = fishs.map(funcCollide)
                .reduce(function (a, b, c) {
                    return b ? a.concat(c) : a;
                }, []);
        if (fishCollision > 0) {
            users.splice(currentPlayer.id, 1);
//        io.emit('playerDied', {name: currentPlayer.name});
            sockets[currentPlayer.id].emit('RIP');
            fishs.splice(fishCollision, 1);
        }

        if (typeof (currentPlayer.speed) == "undefined") {
            currentPlayer.speed = 4;
        }
        playerCircle.r = currentPlayer.radius;
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
        var nbPlayers = 0;
        for (var i = 0; i < users.length; i++) {
            if (users[i].type == 'player') {
                nbPlayers++;
            }
        }
        if (isNaN(leaderboard) || leaderboard.length !== nbPlayers) {
            leaderboard = nbPlayers;
            leaderboardChanged = true;
        }
//        for (i = 0; i < users.length; i++) {
//                if (users[i].size * (1 - (c.sizeLossRate / 1000)) > c.defaultPlayerSize && users[i].size > c.minSizeLoss) {
//                    var sizeLoss = users[i].size * (1 - (c.sizeLossRate / 1000));
//                    users[i].size -= users[i].size - sizeLoss;
//                    users[i].size = sizeLoss;
//                }
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
        var visibleUsers = users
                .map(function (f) {
                    if (f.type == 'player' && f.x + f.radius > u.x - u.screenWidth / 2 - 20 &&
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
                            };
                        }
                    }

                })
                .filter(function (f) {
                    return f;
                });
        sockets[u.id].emit('serverTellPlayerMove', visibleUsers, visibleFishs);
        if (leaderboardChanged) {
            sockets[u.id].emit('leaderboard', {
                players: users.length,
                leaderboard: leaderboard
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
