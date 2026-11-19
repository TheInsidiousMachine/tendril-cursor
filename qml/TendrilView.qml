import QtQuick
import "TendrilCore.js" as Core
import "TendrilRender.js" as Render

// KWin-independent view: give it a pointer position (local px) + buttons and it
// draws the tendril. All behaviour lives in core/tendril_core.js; all drawing in
// core/tendril_render.js. This file is glue only, so it can be tested under a
// plain `qml` runner (test/qml_smoke.sh) without a compositor.
Item {
    id: view

    property real pointerX: 0
    property real pointerY: 0
    property bool pointerInside: true
    property bool leftPressed: false
    property bool rightPressed: false
    // Live overrides of model parameters ({name: number}); unknown keys ignored.
    // An empty map means defaults.
    property var params: ({})

    readonly property var model: Core.TendrilCore.create()
    readonly property var renderer: Render.TendrilRender.create()
    readonly property var pointer: ({ x: pointerX, y: pointerY, seen: true })

    function applyParams() {
        var P = model.P, D = model.DEFAULTS, k
        for (k in D) P[k] = D[k]
        if (params) for (k in params) if (k in D && typeof params[k] === "number" && isFinite(params[k])) P[k] = params[k]
        awake = true
        canvas.requestPaint()
    }
    onParamsChanged: applyParams()
    Component.onCompleted: applyParams()

    // draw only while the pointer is here; re-pose from scratch on re-entry
    onPointerInsideChanged: { if (!pointerInside) model.started = false; awake = true }

    // Stop stepping (and so stop forcing compositor repaints) once the model says
    // nothing can change until the input does. Any input wakes it.
    property bool awake: true
    onPointerXChanged: awake = true
    onPointerYChanged: awake = true
    onLeftPressedChanged: awake = true
    onRightPressedChanged: awake = true
    onWidthChanged: awake = true
    onHeightChanged: awake = true

    // When hosted by the KWin effect the compositor drives tick() once per output
    // frame (vsync-locked). FrameAnimation is only for hosts without a clock (tests).
    property bool externalClock: false
    // {"debugDemo": 1} in params: drive a scribble instead of the pointer (perf
    // measurement inside KWin without touching the real mouse)
    property real demoT: 0
    function tick(dt) {
        var demo = view.params && view.params.debugDemo > 0
        if ((!view.pointerInside && !demo) || view.width <= 0 || (!view.awake && !demo)) return false
        var px = view.pointerX, py = view.pointerY
        if (demo) {
            view.demoT += dt
            var T = view.demoT, W = view.width, H = view.height
            px = W / 2 + W * 0.31 * Math.sin(T * 5.3) * Math.cos(T * 1.1)
            py = H / 2 + H * 0.32 * Math.sin(T * 7.1 + 1)
            view.awake = true
        }
        view.model.leftPressed = view.leftPressed
        view.model.rightPressed = view.rightPressed
        view.model.step(dt, px, py, view.width, view.height)
        if (view.model.idle === 0) canvas.requestPaint()
        if (view.model.asleep) view.awake = false
        return view.awake
    }

    FrameAnimation {
        running: !view.externalClock && view.pointerInside && view.width > 0 && view.awake
        onTriggered: {
            view.model.leftPressed = view.leftPressed
            view.model.rightPressed = view.rightPressed
            view.model.step(frameTime, view.pointerX, view.pointerY, view.width, view.height)
            if (view.model.idle === 0) canvas.requestPaint()
            if (view.model.asleep) view.awake = false
        }
    }

    Canvas {
        id: canvas
        // Full-output canvas: with threaded painting a moving/resizing canvas could show
        // a frame painted for its old geometry; the raster cost is on the worker thread.
        anchors.fill: parent
        visible: view.pointerInside || (view.params && view.params.debugDemo > 0)
        antialiasing: true
        // rasterise on a worker thread: QPainter work must not sit in the compositor's frame
        renderStrategy: Canvas.Threaded
        onPaint: {
            var ctx = getContext("2d")
            ctx.reset()
            ctx.clearRect(0, 0, width, height)
            if (view.model.started)
                view.renderer.draw(ctx, view.model, view.pointer, view.width, view.height)
        }
    }
}
