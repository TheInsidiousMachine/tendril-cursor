import QtQuick

// Thin KWin glue: one TendrilView per output, fed by the effect's pointer state.
// Created by TendrilEffect as an OffscreenQuickScene drawn on KWin's overlay layer.
Item {
    id: root

    // Filled by TendrilEffect (initial properties, updated on output changes).
    required property QtObject effect
    property real screenX
    property real screenY
    property real screenWidth
    property real screenHeight

    width: screenWidth
    height: screenHeight

    readonly property real px: effect.cursorPosition.x - screenX
    readonly property real py: effect.cursorPosition.y - screenY

    // called by TendrilEffect from prePaintScreen, once per frame of this output;
    // returns whether it still needs frames
    function tick(dt) { return tendril.tick(dt) }

    TendrilView {
        id: tendril
        anchors.fill: parent
        externalClock: true
        pointerX: root.px
        pointerY: root.py
        pointerInside: root.px >= 0 && root.py >= 0 && root.px <= root.width && root.py <= root.height
        leftPressed: root.effect.leftPressed
        rightPressed: root.effect.rightPressed
        params: root.effect.params
    }
}
