module.exports = {
    // Keys and other mathematical constants
    KEY_ESC: 27,
    KEY_ENTER: 13,
    KEY_LEFT: 37,
    KEY_UP: 38,
    KEY_RIGHT: 39,
    KEY_DOWN: 40,
    borderDraw: true,
    spin: -Math.PI,
    enemySpin: -Math.PI,
    mobile: false,
    fishsSides: 20,

    // Canvas
    screenWidth: window.innerWidth,
    screenHeight: window.innerHeight,
    gameWidth: 0,
    gameHeight: 0,
    playerBorder: 0,
    xoffset: -0,
    yoffset: -0,
    gameStart: false,
    disconnected: false,
    died: false,
    win: false,
    followPlayer: false,
    kicked: false,
    startPingTime: 0,
    willFollow: false,
    backgroundColor: '#f2fbff',
    lineColor: '#000000',
};
