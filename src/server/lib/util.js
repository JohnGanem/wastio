/* jslint node: true */

'use strict';

var cfg = require('../../../config.json');

exports.validNick = function (nickname) {
    var regex = /^\w*$/;
    return regex.exec(nickname) !== null;
};

// determine size from radius of circle
exports.sizeToRadius = function (size) {
    return Math.round(size / 2);
};


// overwrite Math.log function
exports.log = (function () {
    var log = Math.log;
    return function (n, base) {
        return log(n) / (base ? log(base) : 1);
    };
})();

// get the Euclidean distance between the edges of two shapes
exports.getDistance = function (p1, p2) {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2)) - p1.radius - p2.radius;
};

exports.randomInRange = function (from, to) {
    return Math.floor(Math.random() * (to - from)) + from;
};

// generate a random position within the field of play
exports.randomPosition = function (radius) {
    return {
        x: exports.randomInRange(radius, cfg.gameWidth - radius),
        y: exports.randomInRange(radius, cfg.gameHeight - radius)
    };
};

// generate the center position
exports.centerPosition = function () {
    return {
        x: cfg.gameWidth / 2,
        y: cfg.gameHeight / 2
    };
};

// generate a random position near center
exports.randomCenterPosition = function () {
    return {
        x: exports.randomInRange((cfg.gameWidth / 2) - cfg.startSpace, (cfg.gameWidth / 2) + cfg.startSpace),
        y: exports.randomInRange((cfg.gameHeight / 2) - cfg.startSpace, (cfg.gameHeight / 2) + cfg.startSpace)
    };
};

// generate a random position at the border

exports.randomBorder = function (start, radius) {
    var coordinates;
    switch (start) {
        case 1:
            coordinates = {
                x: cfg.gameWidth - radius,
                y: exports.randomInRange(radius, cfg.gameHeight - radius)
            };
            break;
        case 2:
            coordinates = {
                x: exports.randomInRange(radius, cfg.gameWidth - radius),
                y: cfg.gameHeight - radius
            };
            break;
        case 3:
            coordinates = {
                x: radius,
                y: exports.randomInRange(radius, cfg.gameHeight - radius)
            };
            break;
        default:
            coordinates = {
                x: exports.randomInRange(radius, cfg.gameWidth - radius),
                y: radius
            };
    }
    return coordinates;
};

// generate a random target at the border
exports.randomTargetBorder = function (start, radius) {
    var coordinates;
    var angle = cfg.angleProjection;
    switch (start) {
        case 1:
            coordinates = {
                x: -1,
                y: exports.randomInRange(-angle, angle)
            };
            break;
        case 2:
            coordinates = {
                x: exports.randomInRange(-angle, angle),
                y: -1
            };
            break;
        case 3:
            coordinates = {
                x: 1,
                y: exports.randomInRange(-angle, angle)
            };
            break;
        default:
            coordinates = {
                x: exports.randomInRange(-angle, angle),
                y: 1
            };
    }
    return coordinates;
};

exports.uniformPosition = function (points, radius) {
    var bestCandidate, maxDistance = 0;
    var numberOfCandidates = 10;

    if (points.length === 0) {
        return exports.randomPosition(radius);
    }

    // Generate the candidates
    for (var ci = 0; ci < numberOfCandidates; ci++) {
        var minDistance = Infinity;
        var candidate = exports.randomPosition(radius);
        candidate.radius = radius;

        for (var pi = 0; pi < points.length; pi++) {
            var distance = exports.getDistance(candidate, points[pi]);
            if (distance < minDistance) {
                minDistance = distance;
            }
        }

        if (minDistance > maxDistance) {
            bestCandidate = candidate;
            maxDistance = minDistance;
        } else {
            return exports.randomPosition(radius);
        }
    }

    return bestCandidate;
};

exports.findIndex = function (arr, id) {
    var len = arr.length;

    while (len--) {
        if (arr[len].id === id) {
            return len;
        }
    }

    return -1;
};

exports.randomColor = function () {
    var color = '#' + ('00000' + (Math.random() * (1 << 24) | 0).toString(16)).slice(-6);
    var c = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
    var r = (parseInt(c[1], 16) - 32) > 0 ? (parseInt(c[1], 16) - 32) : 0;
    var g = (parseInt(c[2], 16) - 32) > 0 ? (parseInt(c[2], 16) - 32) : 0;
    var b = (parseInt(c[3], 16) - 32) > 0 ? (parseInt(c[3], 16) - 32) : 0;

    return {
        fill: color,
        border: '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)
    };
};
