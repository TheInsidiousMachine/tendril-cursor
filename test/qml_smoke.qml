import QtQuick
import QtQuick.Window

// Runs TendrilView (the exact QML the KWin effect uses) offscreen, drives a figure-8,
// grabs a PNG, prints a result line and exits non-zero on failure.
Window {
    id: win
    width: 1400; height: 800; visible: true; color: "#10161b"
    property real t: 0
    property string out: ""

    TendrilView {
        id: v
        anchors.fill: parent
        pointerX: 700 + 420 * Math.sin(win.t * 1.7)
        pointerY: 420 + 250 * Math.sin(win.t * 3.4)
    }
    Timer {
        interval: 16; running: true; repeat: true
        onTriggered: {
            win.t += 0.016
            if (win.t > 3.5) {
                running = false
                v.grabToImage(function (r) {
                    var ok = r.saveToFile(win.out)
                    var m = v.model
                    console.warn("RESULT saved=" + ok + " nodes=" + m.chain.length +
                                " arm=" + Math.round(m.armLength()) + " started=" + m.started)
                    Qt.exit(ok && m.chain.length > 4 ? 0 : 1)
                })
            }
        }
    }
}
