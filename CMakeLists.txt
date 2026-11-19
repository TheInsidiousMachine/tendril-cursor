cmake_minimum_required(VERSION 3.24)
project(tendrilcursor VERSION 0.3.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# A KWin effect must be a shared MODULE, or kcoreaddons_add_plugin() falls
# back to a static archive that has no install rule and KWin cannot load.
set(BUILD_SHARED_LIBS ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)

find_package(ECM REQUIRED NO_MODULE)
list(APPEND CMAKE_MODULE_PATH ${ECM_MODULE_PATH})

# Find Qt6 before the KDE install-dir logic so KDEInstallDirs can pick up
# Qt's real plugin directory (lib64/qt6/plugins) rather than guessing.
find_package(Qt6 REQUIRED COMPONENTS Core Gui Qml Quick Widgets)
find_package(KF6 REQUIRED COMPONENTS CoreAddons)
find_package(KWin 6.6 REQUIRED)

include(KDEInstallDirs)
include(KDECMakeSettings)
include(KDECompilerSettings NO_POLICY_SCOPE)

# KDECMakeSettings only sets these when find_package(ECM) was called with a
# version >= 5.38; this project pins no ECM version, so set them ourselves.
# kcoreaddons_add_plugin() hard-errors without CMAKE_LIBRARY_OUTPUT_DIRECTORY.
if(NOT CMAKE_LIBRARY_OUTPUT_DIRECTORY)
    set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)
    set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)
    set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)
endif()

# KWin only scans Qt's plugin path for out-of-tree effects. If the KDE
# install logic did not land there, force it.
if(NOT KDE_INSTALL_PLUGINDIR MATCHES "qt6/plugins")
    set(KDE_INSTALL_PLUGINDIR "${CMAKE_INSTALL_LIBDIR}/qt6/plugins")
endif()

# The shared model/renderer are plain JS (also loaded by the browser bench and
# node tests). QML needs `.pragma library` as the first line of a shared script,
# which would be a syntax error elsewhere, so generate QML copies at configure
# time. Editing core/*.js re-runs configure automatically.
set(TENDRIL_GEN ${CMAKE_BINARY_DIR}/qmlgen)
foreach(js tendril_core tendril_render)
    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${CMAKE_SOURCE_DIR}/core/${js}.js)
endforeach()
file(READ ${CMAKE_SOURCE_DIR}/core/tendril_core.js TENDRIL_CORE_JS)
file(READ ${CMAKE_SOURCE_DIR}/core/tendril_render.js TENDRIL_RENDER_JS)
file(WRITE ${TENDRIL_GEN}/TendrilCore.js ".pragma library\n${TENDRIL_CORE_JS}")
file(WRITE ${TENDRIL_GEN}/TendrilRender.js ".pragma library\n${TENDRIL_RENDER_JS}")
set_source_files_properties(${TENDRIL_GEN}/TendrilCore.js PROPERTIES QT_RESOURCE_ALIAS qml/TendrilCore.js)
set_source_files_properties(${TENDRIL_GEN}/TendrilRender.js PROPERTIES QT_RESOURCE_ALIAS qml/TendrilRender.js)
set_source_files_properties(qml/main.qml PROPERTIES QT_RESOURCE_ALIAS qml/main.qml)
set_source_files_properties(qml/TendrilView.qml PROPERTIES QT_RESOURCE_ALIAS qml/TendrilView.qml)

kcoreaddons_add_plugin(tendrilcursor
    SOURCES
        src/tendril_effect.cpp
        src/tendril_effect.h
    INSTALL_NAMESPACE "kwin/effects/plugins"
)

# KWin never unloads an effect library, and Qt's resource registry is process-
# global. So every build gets a unique plugin id (= .so file name) and a unique
# qrc prefix: a fresh build can then be loaded into the RUNNING KWin without a
# relog, and an older build already resident in KWin can never shadow its files.
string(TIMESTAMP TENDRIL_BUILD "%Y%m%d%H%M%S")
set(TENDRIL_ID "tendril_${TENDRIL_BUILD}")
set_target_properties(tendrilcursor PROPERTIES OUTPUT_NAME ${TENDRIL_ID})
target_compile_definitions(tendrilcursor PRIVATE TENDRIL_QML_URL="qrc:/${TENDRIL_ID}/qml/main.qml")

qt_add_resources(tendrilcursor tendril_qml
    PREFIX "/${TENDRIL_ID}"
    FILES
        qml/main.qml
        qml/TendrilView.qml
        ${TENDRIL_GEN}/TendrilCore.js
        ${TENDRIL_GEN}/TendrilRender.js
)

target_link_libraries(tendrilcursor
    PRIVATE
        KWin::kwin
        Qt6::Core
        Qt6::Gui
        Qt6::Qml
        Qt6::Quick
        KF6::CoreAddons
)
