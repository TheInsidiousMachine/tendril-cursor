#pragma once

#include <effect/effect.h>
#include <effect/offscreenquickview.h>

#include <QFileSystemWatcher>
#include <QPointF>
#include <QTimer>
#include <QVariantMap>

#include <chrono>
#include <map>
#include <vector>
#include <memory>

namespace KWin {
class LogicalOutput;
}

// A plain (non-fullscreen, non-grabbing) effect. One OffscreenQuickScene per
// output; KWin composites those on its overlay layer ON TOP of the normal
// desktop. Do NOT base this on QuickSceneEffect: that is the fullscreen-effect
// base (Overview etc.): it grabs keyboard + mouse and paints only its own scene,
// which is how an earlier build blacked out the screen and swallowed input.
class TendrilEffect final : public KWin::Effect
{
    Q_OBJECT
    Q_PROPERTY(QPointF cursorPosition READ cursorPosition NOTIFY cursorPositionChanged)
    Q_PROPERTY(bool leftPressed READ leftPressed NOTIFY buttonsChanged)
    Q_PROPERTY(bool rightPressed READ rightPressed NOTIFY buttonsChanged)
    Q_PROPERTY(bool middlePressed READ middlePressed NOTIFY buttonsChanged)
    // Live-tunable model parameters from ~/.config/tendril-cursor/params.json
    Q_PROPERTY(QVariantMap params READ params NOTIFY paramsChanged)

public:
    TendrilEffect();
    ~TendrilEffect() override;

    static bool supported();

    // Frame-synced rendering: each output's scene is stepped and rendered inside
    // that output's paint cycle (like KWin's own QuickSceneEffect), not off a timer.
    void prePaintScreen(KWin::ScreenPrePaintData &data) override;
    void postPaintScreen() override;

    QPointF cursorPosition() const { return m_cursorPosition; }
    bool leftPressed() const { return m_buttons.testFlag(Qt::LeftButton); }
    bool rightPressed() const { return m_buttons.testFlag(Qt::RightButton); }
    bool middlePressed() const { return m_buttons.testFlag(Qt::MiddleButton); }
    QVariantMap params() const { return m_params; }

Q_SIGNALS:
    void cursorPositionChanged();
    void buttonsChanged();
    void paramsChanged();

private:
    void addScreen(KWin::LogicalOutput *screen);
    void removeScreen(KWin::LogicalOutput *screen);
    void placeScene(KWin::LogicalOutput *screen);
    void loadParams();
    void watchParams();

    struct Screen {
        std::unique_ptr<KWin::OffscreenQuickScene> scene;
        bool dirty = true;        // QML scene changed, needs a render
        bool animating = true;    // the arm still moves: keep requesting frames
        bool hasLast = false;
        std::chrono::steady_clock::time_point last;
        std::vector<double> dts;  // frame intervals, only with params.debugFps
        int prePaints = 0, ticks = 0;
        double tickMs = 0, updMs = 0, worstTick = 0, worstUpd = 0;
    };
    void wakeAll();
    std::map<KWin::LogicalOutput *, Screen> m_scenes;
    QPointF m_cursorPosition;
    Qt::MouseButtons m_buttons;
    QVariantMap m_params;
    QString m_paramsPath;
    QFileSystemWatcher m_watcher;
    QTimer m_reloadDebounce;
};
