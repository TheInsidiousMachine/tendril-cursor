import QtQuick
import QtQuick.Window
import "TendrilCore.js" as Core
import "TendrilRender.js" as Render

// Paint-cost benchmark of the real renderer in a real QtQuick Canvas (offscreen).
Window {
    id: win
    width: 1920; height: 1080; visible: true; color: "#10161b"
    property real t: 0
    property var model: Core.TendrilCore.create()
    property var rend: Render.TendrilRender.create()
    property var times: []
    Canvas {
        id: c; anchors.fill: parent
        onPaint: {
            var t0 = Date.now()
            var ctx = getContext("2d"); ctx.reset(); ctx.clearRect(0, 0, width, height)
            win.rend.draw(ctx, win.model, { x: win.model.tip.x, y: win.model.tip.y, seen: true }, width, height)
            win.times.push(Date.now() - t0)
        }
    }
    Timer {
        interval: 16; running: true; repeat: true
        onTriggered: {
            win.t += 1 / 60
            var x = 960 + 600 * Math.sin(win.t * 5.3) * Math.cos(win.t * 1.1), y = 540 + 350 * Math.sin(win.t * 7.1 + 1)
            win.model.step(1 / 60, x, y, 1920, 1080)
            c.requestPaint()
            if (win.times.length >= 240) {
                running = false
                var a = win.times.slice().sort(function (p, q) { return p - q })
                var sum = 0; for (var i = 0; i < a.length; i++) sum += a[i]
                console.warn("PERF paints=" + a.length + " mean=" + (sum / a.length).toFixed(2) + "ms p95=" + a[Math.floor(a.length * 0.95)] + "ms max=" + a[a.length - 1] + "ms corners=" + win.model.joints)
                Qt.exit(0)
            }
        }
    }
}
