#include "tendril_effect.h"

#include <core/output.h>
#include <effect/effecthandler.h>

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QQuickItem>
#include <QStandardPaths>
#include <QUrl>

#include <algorithm>

KWIN_EFFECT_FACTORY_SUPPORTED(TendrilEffect, "metadata.json", return TendrilEffect::supported();)

bool TendrilEffect::supported()
{
    return KWin::effects->compositingType() != KWin::NoCompositing;
}

TendrilEffect::TendrilEffect()
{
    m_cursorPosition = KWin::effects->cursorPos();

    // Pointer state without grabbing anything: mouseChanged is emitted for every
    // pointer move / button change (pointerMotion() is only delivered to effects
    // that grab the mouse, which this one must never do).
    connect(KWin::effects, &KWin::EffectsHandler::mouseChanged, this,
            [this](const QPointF &pos, const QPointF &, Qt::MouseButtons buttons, Qt::MouseButtons,
                   Qt::KeyboardModifiers, Qt::KeyboardModifiers) {
                if (pos != m_cursorPosition) {
                    m_cursorPosition = pos;
                    Q_EMIT cursorPositionChanged();
                }
                if (buttons != m_buttons) {
                    m_buttons = buttons;
                    Q_EMIT buttonsChanged();
                }
                wakeAll();
            });

    m_paramsPath = QStandardPaths::writableLocation(QStandardPaths::GenericConfigLocation)
        + QStringLiteral("/tendril-cursor/params.json");
    m_reloadDebounce.setSingleShot(true);
    m_reloadDebounce.setInterval(40);
    connect(&m_reloadDebounce, &QTimer::timeout, this, [this]() {
        loadParams();
        watchParams();
        wakeAll();
    });
    connect(&m_watcher, &QFileSystemWatcher::fileChanged, this, [this]() { m_reloadDebounce.start(); });
    connect(&m_watcher, &QFileSystemWatcher::directoryChanged, this, [this]() { m_reloadDebounce.start(); });
    loadParams();
    watchParams();

    const auto screens = KWin::effects->screens();
    for (KWin::LogicalOutput *screen : screens) {
        addScreen(screen);
    }
    connect(KWin::effects, &KWin::EffectsHandler::screenAdded, this, &TendrilEffect::addScreen);
    connect(KWin::effects, &KWin::EffectsHandler::screenRemoved, this, &TendrilEffect::removeScreen);
}

TendrilEffect::~TendrilEffect() = default;

void TendrilEffect::addScreen(KWin::LogicalOutput *screen)
{
    auto scene = std::make_unique<KWin::OffscreenQuickScene>();
    const KWin::RectF g = screen->geometryF();
    scene->setSource(QUrl(QStringLiteral(TENDRIL_QML_URL)),
                     {
                         {QStringLiteral("effect"), QVariant::fromValue<QObject *>(this)},
                         {QStringLiteral("screenX"), g.x()},
                         {QStringLiteral("screenY"), g.y()},
                         {QStringLiteral("screenWidth"), g.width()},
                         {QStringLiteral("screenHeight"), g.height()},
                     });
    // Manual repaint: a scene change only schedules a compositor frame; the actual
    // render happens in prePaintScreen, in step with the display.
    scene->setAutomaticRepaint(false);
    KWin::OffscreenQuickScene *raw = scene.get();
    auto markDirty = [this, screen]() {
        auto it = m_scenes.find(screen);
        if (it != m_scenes.end()) {
            it->second.dirty = true;
        }
    };
    connect(raw, &KWin::OffscreenQuickView::sceneChanged, this, markDirty);
    connect(raw, &KWin::OffscreenQuickView::renderRequested, this, markDirty);
    Screen st;
    st.scene = std::move(scene);
    m_scenes[screen] = std::move(st);
    placeScene(screen);
    raw->scheduleFrame();
    connect(screen, &KWin::LogicalOutput::geometryChanged, this, [this, screen]() { placeScene(screen); });
    connect(screen, &KWin::LogicalOutput::scaleChanged, this, [this, screen]() { placeScene(screen); });
}

void TendrilEffect::placeScene(KWin::LogicalOutput *screen)
{
    auto it = m_scenes.find(screen);
    if (it == m_scenes.end()) {
        return;
    }
    KWin::OffscreenQuickScene *scene = it->second.scene.get();
    const KWin::RectF g = screen->geometryF();
    scene->setDevicePixelRatio(screen->scale());
    scene->setGeometry(screen->geometry());
    if (QQuickItem *root = scene->rootItem()) {
        root->setProperty("screenX", g.x());
        root->setProperty("screenY", g.y());
        root->setProperty("screenWidth", g.width());
        root->setProperty("screenHeight", g.height());
    }
}

void TendrilEffect::wakeAll()
{
    for (auto &[screen, st] : m_scenes) {
        st.animating = true;
        st.scene->scheduleFrame();
    }
}

void TendrilEffect::prePaintScreen(KWin::ScreenPrePaintData &data)
{
    auto it = data.screen ? m_scenes.find(data.screen) : m_scenes.end();
    static int unknownLogged = 0;
    if (it == m_scenes.end() && unknownLogged < 3 && m_params.value(QStringLiteral("debugFps")).toDouble() > 0) {
        unknownLogged++;
        qWarning("tendril: prePaintScreen for a screen without a scene (screen=%p name=%s, %d scenes)",
                 static_cast<void *>(data.screen), data.screen ? qPrintable(data.screen->name()) : "-", int(m_scenes.size()));
    }
    if (it != m_scenes.end()) {
        Screen &st = it->second;
        const auto now = std::chrono::steady_clock::now();
        const double dt = st.hasLast ? std::chrono::duration<double>(now - st.last).count() : 1.0 / 60.0;
        st.last = now;
        st.hasLast = true;
        st.prePaints++;
        if (st.animating && m_params.value(QStringLiteral("debugFps")).toDouble() > 0) {
            if (st.hasLast) st.dts.push_back(dt * 1000.0);
            if (st.dts.size() >= 240) {
                std::sort(st.dts.begin(), st.dts.end());
                double sum = 0;
                for (double v : st.dts) sum += v;
                qWarning("tendril %s: frames n=%d mean=%.2fms p5=%.2f p95=%.2f max=%.2f | tick avg %.2f max %.2f | render avg %.2f max %.2f ms",
                         qPrintable(data.screen->name()), int(st.dts.size()), sum / st.dts.size(), st.dts[st.dts.size() / 20],
                         st.dts[st.dts.size() * 19 / 20], st.dts.back(), st.tickMs / st.ticks, st.worstTick, st.updMs / st.ticks, st.worstUpd);
                st.dts.clear();
                st.ticks = 0; st.tickMs = st.updMs = st.worstTick = st.worstUpd = 0;
            }
        }
        if (st.animating) {
            st.ticks++;
            if (QQuickItem *root = st.scene->rootItem()) {
                QVariant ret;
                const auto t0 = std::chrono::steady_clock::now();
                QMetaObject::invokeMethod(root, "tick", Q_RETURN_ARG(QVariant, ret), Q_ARG(QVariant, dt));
                const double tm = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
                st.tickMs += tm; st.worstTick = std::max(st.worstTick, tm);
                st.animating = ret.toBool();
                st.dirty = true;   // tick may have requested a canvas repaint; render it this frame
            } else {
                st.animating = false;
            }
        }
        if (st.dirty) {
            st.dirty = false;
            const auto t1 = std::chrono::steady_clock::now();
            st.scene->update(data.frame);   // polish (canvas paint) + render, now
            const double um = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t1).count();
            st.updMs += um; st.worstUpd = std::max(st.worstUpd, um);
        }
        if (!st.animating) {
            st.hasLast = false;   // next wake starts with a nominal frame, not the idle gap
        }
    }
    KWin::effects->prePaintScreen(data);
}

void TendrilEffect::postPaintScreen()
{
    KWin::effects->postPaintScreen();
    for (auto &[screen, st] : m_scenes) {
        if (st.animating) {
            st.scene->scheduleFrame();   // keep the frames coming only while the arm moves
        }
    }
}

void TendrilEffect::removeScreen(KWin::LogicalOutput *screen)
{
    disconnect(screen, nullptr, this, nullptr);
    m_scenes.erase(screen);
}

void TendrilEffect::loadParams()
{
    QVariantMap next;
    QFile f(m_paramsPath);
    if (f.open(QIODevice::ReadOnly)) {
        const QJsonDocument doc = QJsonDocument::fromJson(f.readAll());
        if (doc.isObject()) {
            const QJsonObject o = doc.object();
            for (auto it = o.begin(); it != o.end(); ++it) {
                if (it.value().isDouble()) {
                    next.insert(it.key(), it.value().toDouble());
                }
            }
        }
    }
    if (next != m_params) {
        m_params = next;
        Q_EMIT paramsChanged();
    }
}

// Editors (and the tuner) replace the file by rename, which drops a file watch;
// watch the directory as well and re-arm after every change.
void TendrilEffect::watchParams()
{
    const QString dir = QFileInfo(m_paramsPath).absolutePath();
    QDir().mkpath(dir);
    if (!m_watcher.directories().contains(dir)) {
        m_watcher.addPath(dir);
    }
    if (QFile::exists(m_paramsPath) && !m_watcher.files().contains(m_paramsPath)) {
        m_watcher.addPath(m_paramsPath);
    }
}

#include "tendril_effect.moc"
