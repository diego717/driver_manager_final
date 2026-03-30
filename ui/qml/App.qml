import QtQuick
import QtQuick.Layouts

Rectangle {
    id: root
    width: 1440
    height: 920
    color: "#dbe6f4"

    property int currentScreen: 0
    property color ink: "#102033"
    property color subInk: "#4e6480"
    property color line: "#b7c8dd"
    property color card: "#f7fbff"
    property color cardSoft: "#eef4fb"
    property color accent: "#1b4d78"
    property color accentSoft: "#d5e4f3"
    property color warning: "#8f5f1c"
    property color warningSoft: "#ead7bd"

    FontLoader {
        id: displayFont
        source: "../../mobile-app/assets/fonts/IBMPlexSansCondensed-Regular.ttf"
    }

    FontLoader {
        id: bodyFont
        source: "../../mobile-app/assets/fonts/SourceSans3-Regular.ttf"
    }

    FontLoader {
        id: monoFont
        source: "../../mobile-app/assets/fonts/IBMPlexMono-Regular.ttf"
    }

    function displayFamily() {
        return displayFont.status === FontLoader.Ready ? displayFont.name : "Segoe UI"
    }

    function bodyFamily() {
        return bodyFont.status === FontLoader.Ready ? bodyFont.name : "Segoe UI"
    }

    function monoFamily() {
        return monoFont.status === FontLoader.Ready ? monoFont.name : "Consolas"
    }

    function navLabel(index) {
        if (index === 0) return "Drivers"
        if (index === 1) return "Incidencias"
        if (index === 2) return "Historial"
        return "Administracion"
    }

    RowLayout {
        anchors.fill: parent
        spacing: 0

        Rectangle {
            Layout.preferredWidth: 276
            Layout.fillHeight: true
            color: "#0d1b2a"

            Column {
                anchors.fill: parent
                anchors.margins: 18
                spacing: 18

                Rectangle {
                    width: parent.width
                    height: 156
                    radius: 24
                    color: "#13263b"
                    border.width: 1
                    border.color: "#2e4a66"

                    Column {
                        anchors.fill: parent
                        anchors.margins: 18
                        spacing: 6

                        Text {
                            text: "SITEOPS / DESKTOP"
                            color: "#8eabc8"
                            font.family: root.monoFamily()
                            font.pixelSize: 12
                            font.weight: Font.DemiBold
                        }

                        Text {
                            text: "Windows UI v2"
                            width: parent.width
                            wrapMode: Text.WordWrap
                            color: "#f2f7fc"
                            font.family: root.displayFamily()
                            font.pixelSize: 28
                            font.weight: Font.Bold
                        }

                        Text {
                            text: "Nueva base editorial para migrar la app sin seguir remendando."
                            color: "#a9bfd5"
                            width: parent.width
                            wrapMode: Text.WordWrap
                            font.family: root.bodyFamily()
                            font.pixelSize: 13
                            lineHeight: 1.15
                        }
                    }
                }

                Repeater {
                    model: 4

                    delegate: Rectangle {
                        required property int index
                        width: parent ? parent.width : 200
                        height: 82
                        radius: 18
                        color: root.currentScreen === index ? "#f4f8fd" : "#13263b"
                        border.width: 1
                        border.color: root.currentScreen === index ? "#f4f8fd" : "#2f4b67"

                        Column {
                            anchors.fill: parent
                            anchors.margins: 14
                            spacing: 2

                            Text {
                                text: root.navLabel(index)
                                color: root.currentScreen === index ? "#102033" : "#e5eef8"
                                font.family: root.displayFamily()
                                font.pixelSize: 18
                                font.weight: Font.Bold
                            }

                            Text {
                                text: index === 0 ? "Catalogo y cargas" :
                                      index === 1 ? "Estados y evidencia" :
                                      index === 2 ? "Seguimiento y reportes" :
                                      "Config y plataforma"
                                width: parent.width
                                wrapMode: Text.WordWrap
                                color: root.currentScreen === index ? "#506883" : "#89a4c1"
                                font.family: root.bodyFamily()
                                font.pixelSize: 12
                            }
                        }

                        MouseArea {
                            anchors.fill: parent
                            onClicked: root.currentScreen = index
                            cursorShape: Qt.PointingHandCursor
                        }
                    }
                }

                Item { width: 1; height: 1; Layout.fillHeight: true }

                Rectangle {
                    width: parent.width
                    height: 128
                    radius: 22
                    color: "#13263b"
                    border.width: 1
                    border.color: "#2e4a66"

                    Column {
                        anchors.fill: parent
                        anchors.margins: 16
                        spacing: 4

                        Text {
                            text: "Decision de arquitectura"
                            color: "#eaf1f9"
                            font.family: root.displayFamily()
                            font.pixelSize: 18
                            font.weight: Font.Bold
                        }

                        Text {
                            text: "Migrar pantalla por pantalla a esta capa nueva en lugar de seguir corrigiendo la legacy."
                            width: parent.width
                            color: "#93afca"
                            wrapMode: Text.WordWrap
                            font.family: root.bodyFamily()
                            font.pixelSize: 12
                        }
                    }
                }
            }
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            color: "#dbe6f4"

            Column {
                anchors.fill: parent
                anchors.margins: 18
                spacing: 16

                Rectangle {
                    width: parent.width
                    height: 108
                    radius: 26
                    color: "#f7fbff"
                    border.width: 1
                    border.color: root.line

                    RowLayout {
                        anchors.fill: parent
                        anchors.margins: 20
                        spacing: 18

                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 4

                            Text {
                                text: root.currentScreen === 0 ? "Catalogo operacional de drivers" :
                                      root.currentScreen === 1 ? "Console de incidencias" :
                                      root.currentScreen === 2 ? "Historial y reportes" :
                                      "Administracion de plataforma"
                                color: root.ink
                                font.family: root.displayFamily()
                                font.pixelSize: 34
                                font.weight: Font.Bold
                            }

                            Text {
                                text: root.currentScreen === 0 ? "Asimetria controlada, rail secundario y foco en navegacion tecnica." :
                                      root.currentScreen === 1 ? "Estados, evidencia y responsables en un layout mas claro y menos fragmentado." :
                                      root.currentScreen === 2 ? "Lectura historica y reportes con jerarquia editorial." :
                                      "Una zona de gobierno separada del trabajo operativo diario."
                                color: root.subInk
                                font.family: root.bodyFamily()
                                font.pixelSize: 14
                            }
                        }

                        Rectangle {
                            Layout.preferredWidth: 176
                            Layout.preferredHeight: 52
                            radius: 18
                            color: "#102033"

                            Text {
                                anchors.centerIn: parent
                                text: "EXPERIMENTAL V2"
                                color: "#f4f8fd"
                                font.family: root.monoFamily()
                                font.pixelSize: 13
                                font.weight: Font.DemiBold
                            }
                        }
                    }
                }

                RowLayout {
                    width: parent.width
                    spacing: 12

                    Repeater {
                        model: [
                            ["Direccion visual", "Industrial, clara y con mas contraste de jerarquia."],
                            ["Cambio de base", "Shell nuevo, composicion nueva, migracion por pantallas."],
                            ["Objetivo", "Dejar de iterar sobre una UI que ya nacio mal estructurada."]
                        ]

                        delegate: Rectangle {
                            required property var modelData
                            Layout.fillWidth: true
                            Layout.preferredHeight: 112
                            radius: 22
                            color: "#f7fbff"
                            border.width: 1
                            border.color: root.line

                            Column {
                                anchors.fill: parent
                                anchors.margins: 18
                                spacing: 6

                                Text {
                                    text: modelData[0]
                                    color: root.ink
                                    font.family: root.displayFamily()
                                    font.pixelSize: 22
                                    font.weight: Font.Bold
                                }

                                Text {
                                    text: modelData[1]
                                    color: root.subInk
                                    wrapMode: Text.WordWrap
                                    font.family: root.bodyFamily()
                                    font.pixelSize: 13
                                }
                            }
                        }
                    }
                }

                Item {
                    width: parent.width
                    height: parent.height - 260

                    Rectangle {
                        anchors.fill: parent
                        radius: 28
                        color: "#f7fbff"
                        border.width: 1
                        border.color: root.line
                    }

                    Item {
                        anchors.fill: parent
                        anchors.margins: 18
                        visible: root.currentScreen === 0

                        RowLayout {
                            anchors.fill: parent
                            spacing: 18

                            Rectangle {
                                Layout.fillHeight: true
                                Layout.preferredWidth: 430
                                radius: 22
                                color: "#edf4fb"
                                border.width: 1
                                border.color: root.line

                                Column {
                                    anchors.fill: parent
                                    anchors.margins: 18
                                    spacing: 12

                                    Text {
                                        text: "Drivers / cola operacional"
                                        color: root.ink
                                        font.family: root.displayFamily()
                                        font.pixelSize: 28
                                        font.weight: Font.Bold
                                    }

                                    Text {
                                        text: "Catalogo real conectado al backend actual, con filtro editorial por marca."
                                        color: root.subInk
                                        font.family: root.bodyFamily()
                                        font.pixelSize: 13
                                    }

                                    Row {
                                        width: parent.width
                                        spacing: 10

                                        Rectangle {
                                            width: 138
                                            height: 42
                                            radius: 14
                                            color: "#102033"

                                            Text {
                                                anchors.centerIn: parent
                                                text: driversBridge.busy ? "Actualizando..." : "Actualizar"
                                                color: "#f4f8fd"
                                                font.family: root.bodyFamily()
                                                font.pixelSize: 14
                                                font.weight: Font.Bold
                                            }

                                            MouseArea {
                                                anchors.fill: parent
                                                enabled: !driversBridge.busy
                                                cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                                                onClicked: driversBridge.refreshDrivers()
                                            }
                                        }

                                        Rectangle {
                                            width: parent.width - 148
                                            height: 42
                                            radius: 14
                                            color: "#f7fbff"
                                            border.width: 1
                                            border.color: root.line

                                            Row {
                                                anchors.fill: parent
                                                anchors.leftMargin: 14
                                                anchors.rightMargin: 14
                                                anchors.verticalCenter: parent.verticalCenter
                                                spacing: 10

                                                Rectangle {
                                                    width: 10
                                                    height: 10
                                                    radius: 5
                                                    color: driversBridge.busy ? "#c0862d" : "#3a6a95"
                                                }

                                                Text {
                                                    text: driversBridge.statusMessage
                                                    color: root.subInk
                                                    font.family: root.bodyFamily()
                                                    font.pixelSize: 13
                                                    verticalAlignment: Text.AlignVCenter
                                                }
                                            }
                                        }
                                    }

                                    Flickable {
                                        width: parent.width
                                        height: 54
                                        contentWidth: brandRow.width
                                        contentHeight: 54
                                        clip: true

                                        Row {
                                            id: brandRow
                                            spacing: 8

                                            Repeater {
                                                model: driversBridge.brands

                                                delegate: Rectangle {
                                                    required property string modelData
                                                    width: Math.max(92, label.implicitWidth + 28)
                                                    height: 44
                                                    radius: 15
                                                    color: driversBridge.currentFilter === modelData ? "#102033" : "#f7fbff"
                                                    border.width: 1
                                                    border.color: driversBridge.currentFilter === modelData ? "#102033" : root.line

                                                    Text {
                                                        id: label
                                                        anchors.centerIn: parent
                                                        text: modelData
                                                        color: driversBridge.currentFilter === modelData ? "#f4f8fd" : root.ink
                                                        font.family: root.bodyFamily()
                                                        font.pixelSize: 14
                                                        font.weight: Font.DemiBold
                                                    }

                                                    MouseArea {
                                                        anchors.fill: parent
                                                        cursorShape: Qt.PointingHandCursor
                                                        onClicked: driversBridge.setBrandFilter(modelData)
                                                    }
                                                }
                                            }
                                        }
                                    }

                                    Rectangle {
                                        width: parent.width
                                        height: parent.height - 228
                                        radius: 18
                                        color: "#f7fbff"
                                        border.width: 1
                                        border.color: root.line

                                        ListView {
                                            id: driversList
                                            anchors.fill: parent
                                            anchors.margins: 8
                                            clip: true
                                            spacing: 8
                                            model: driversBridge.driverListModel
                                            currentIndex: driversBridge.currentIndex

                                            delegate: Rectangle {
                                                required property int index
                                                required property string name
                                                required property string summary
                                                width: ListView.view.width
                                                height: 74
                                                radius: 16
                                                color: ListView.isCurrentItem ? "#d5e4f3" : "#ffffff"
                                                border.width: 1
                                                border.color: ListView.isCurrentItem ? "#3a6a95" : root.line

                                                Column {
                                                    anchors.fill: parent
                                                    anchors.margins: 14
                                                    spacing: 4

                                                    Text {
                                                        text: name
                                                        color: root.ink
                                                        font.family: root.displayFamily()
                                                        font.pixelSize: 20
                                                        font.weight: Font.Bold
                                                        elide: Text.ElideRight
                                                    }

                                                    Text {
                                                        text: summary
                                                        color: root.subInk
                                                        font.family: root.bodyFamily()
                                                        font.pixelSize: 12
                                                        elide: Text.ElideRight
                                                    }
                                                }

                                                MouseArea {
                                                    anchors.fill: parent
                                                    cursorShape: Qt.PointingHandCursor
                                                    onClicked: {
                                                        driversList.currentIndex = index
                                                        driversBridge.selectDriver(index)
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            Rectangle {
                                Layout.fillWidth: true
                                Layout.fillHeight: true
                                radius: 22
                                color: "#0f2134"

                                Flickable {
                                    anchors.fill: parent
                                    anchors.margins: 22
                                    clip: true
                                    contentWidth: width
                                    contentHeight: rightPanelContent.implicitHeight

                                    Column {
                                        id: rightPanelContent
                                        width: parent.width
                                        spacing: 16

                                    Text {
                                        text: driversBridge.selectedTitle
                                        color: "#f3f8fd"
                                        font.family: root.displayFamily()
                                        font.pixelSize: 34
                                        font.weight: Font.Bold
                                    }

                                    Text {
                                        text: driversBridge.selectedMeta
                                        color: "#97b4cf"
                                        width: parent.width - 8
                                        wrapMode: Text.WordWrap
                                        font.family: root.bodyFamily()
                                        font.pixelSize: 14
                                    }

                                    Rectangle {
                                        width: parent.width
                                        height: 244
                                        radius: 20
                                        color: "#14283e"
                                        border.width: 1
                                        border.color: "#29415b"

                                        Flickable {
                                            anchors.fill: parent
                                            anchors.margins: 18
                                            clip: true
                                            contentWidth: detailText.width
                                            contentHeight: detailText.height

                                            Text {
                                                id: detailText
                                                width: parent.width
                                                text: driversBridge.selectedDetails
                                                color: "#e4eef8"
                                                font.family: root.bodyFamily()
                                                font.pixelSize: 15
                                                lineHeight: 1.45
                                                wrapMode: Text.WordWrap
                                            }
                                        }
                                    }

                                    Row {
                                        spacing: 10

                                        Rectangle {
                                            width: 150
                                            height: 50
                                            radius: 16
                                            color: driversBridge.canRunActions ? "#f4f8fd" : "#94a8bb"

                                            Text {
                                                anchors.centerIn: parent
                                                text: "Descargar"
                                                color: "#102033"
                                                font.family: root.bodyFamily()
                                                font.pixelSize: 14
                                                font.weight: Font.Bold
                                            }

                                            MouseArea {
                                                anchors.fill: parent
                                                enabled: driversBridge.canRunActions && !driversBridge.busy
                                                cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                                                onClicked: driversBridge.downloadSelected()
                                            }
                                        }

                                        Rectangle {
                                            width: 160
                                            height: 50
                                            radius: 16
                                            color: driversBridge.canRunActions ? "#d0ad72" : "#8b7a61"

                                            Text {
                                                anchors.centerIn: parent
                                                text: "Instalar"
                                                color: "#102033"
                                                font.family: root.bodyFamily()
                                                font.pixelSize: 14
                                                font.weight: Font.Bold
                                            }

                                            MouseArea {
                                                anchors.fill: parent
                                                enabled: driversBridge.canRunActions && !driversBridge.busy
                                                cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                                                onClicked: driversBridge.installSelected()
                                            }
                                        }
                                    }

                                    Rectangle {
                                        width: parent.width
                                        height: 164
                                        radius: 20
                                        color: "#14283e"
                                        border.width: 1
                                        border.color: "#29415b"

                                        Column {
                                            anchors.fill: parent
                                            anchors.margins: 18
                                            spacing: 12

                                            Text {
                                                text: "Rail operativo"
                                                color: "#f3f8fd"
                                                font.family: root.displayFamily()
                                                font.pixelSize: 22
                                                font.weight: Font.Bold
                                            }

                                            Text {
                                                text: "Accesos rapidos para QR, asociacion de equipos y gestion del inventario."
                                                color: "#97b4cf"
                                                width: parent.width
                                                wrapMode: Text.WordWrap
                                                font.family: root.bodyFamily()
                                                font.pixelSize: 13
                                            }

                                            Row {
                                                spacing: 10

                                                Repeater {
                                                    model: [
                                                        ["QR equipo", "Generar codigo local", "openQrGenerator"],
                                                        ["Asociar equipo", "Vincular a un registro", "associateAsset"],
                                                        ["Gestion de equipos", "Abrir panel completo", "manageAssets"]
                                                    ]

                                                    delegate: Rectangle {
                                                        required property var modelData
                                                        width: 188
                                                        height: 66
                                                        radius: 16
                                                        color: "#1a3248"
                                                        border.width: 1
                                                        border.color: "#35516d"

                                                        Column {
                                                            anchors.fill: parent
                                                            anchors.margins: 14
                                                            spacing: 4

                                                            Text {
                                                                text: modelData[0]
                                                                color: "#eef5fb"
                                                                font.family: root.displayFamily()
                                                                font.pixelSize: 18
                                                                font.weight: Font.Bold
                                                            }

                                                            Text {
                                                                text: modelData[1]
                                                                color: "#9bb6d1"
                                                                font.family: root.bodyFamily()
                                                                font.pixelSize: 12
                                                            }
                                                        }

                                                        MouseArea {
                                                            anchors.fill: parent
                                                            cursorShape: Qt.PointingHandCursor
                                                            onClicked: {
                                                                if (modelData[2] === "openQrGenerator") driversBridge.openQrGenerator()
                                                                else if (modelData[2] === "associateAsset") driversBridge.associateAsset()
                                                                else if (modelData[2] === "manageAssets") driversBridge.manageAssets()
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }

                                    Rectangle {
                                        width: parent.width
                                        height: 148
                                        radius: 20
                                        color: "#f4ede0"
                                        border.width: 1
                                        border.color: "#d0ad72"

                                        Column {
                                            anchors.fill: parent
                                            anchors.margins: 18
                                            spacing: 10

                                            Text {
                                                text: "Carga administrativa"
                                                color: "#5b3e13"
                                                font.family: root.displayFamily()
                                                font.pixelSize: 22
                                                font.weight: Font.Bold
                                            }

                                            Text {
                                                text: "Sube un paquete nuevo con metadata valida y publica el catalogo sin volver a la legacy."
                                                color: "#725221"
                                                width: parent.width
                                                wrapMode: Text.WordWrap
                                                font.family: root.bodyFamily()
                                                font.pixelSize: 13
                                            }

                                            Row {
                                                spacing: 12

                                                Rectangle {
                                                    width: 188
                                                    height: 46
                                                    radius: 15
                                                    color: "#102033"

                                                    Text {
                                                        anchors.centerIn: parent
                                                        text: "Subir driver"
                                                        color: "#f4f8fd"
                                                        font.family: root.bodyFamily()
                                                        font.pixelSize: 14
                                                        font.weight: Font.Bold
                                                    }

                                                    MouseArea {
                                                        anchors.fill: parent
                                                        enabled: !driversBridge.busy
                                                        cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                                                        onClicked: driversBridge.uploadDriver()
                                                    }
                                                }

                                                Rectangle {
                                                    width: 220
                                                    height: 46
                                                    radius: 15
                                                    color: "#f8f3eb"
                                                    border.width: 1
                                                    border.color: "#d7ba8a"
                                                    visible: driversBridge.uploadProgress >= 0

                                                    Text {
                                                        anchors.centerIn: parent
                                                        text: driversBridge.uploadProgress >= 0
                                                            ? "Progreso de carga: " + driversBridge.uploadProgress + "%"
                                                            : ""
                                                        color: "#6d4d1d"
                                                        font.family: root.bodyFamily()
                                                        font.pixelSize: 13
                                                        font.weight: Font.DemiBold
                                                    }
                                                }
                                            }
                                        }
                                    }

                                        Text {
                                            text: "Siguiente slice: QR, asociacion de equipos y carga administrativa sobre esta misma superficie."
                                            color: "#7fa0c0"
                                            font.family: root.bodyFamily()
                                            font.pixelSize: 13
                                        }
                                    }
                                }
                            }
                        }
                    }

                    Item {
                        anchors.fill: parent
                        anchors.margins: 18
                        visible: root.currentScreen === 1

                        RowLayout {
                            anchors.fill: parent
                            spacing: 18

                            Rectangle {
                                Layout.preferredWidth: 420
                                Layout.fillHeight: true
                                radius: 22
                                color: "#edf4fb"
                                border.width: 1
                                border.color: root.line

                                Column {
                                    anchors.fill: parent
                                    anchors.margins: 18
                                    spacing: 12

                                    Text {
                                        text: "Registros operativos"
                                        color: root.ink
                                        font.family: root.displayFamily()
                                        font.pixelSize: 28
                                        font.weight: Font.Bold
                                    }

                                    Text {
                                        text: "Base real de instalaciones con incidencias asociadas y lectura por filtros."
                                        color: root.subInk
                                        font.family: root.bodyFamily()
                                        font.pixelSize: 13
                                    }

                                    Row {
                                        width: parent.width
                                        spacing: 10

                                        Repeater {
                                            model: [
                                                ["Registros", incidentsBridge.recordsMetric],
                                                ["Abiertas", incidentsBridge.openIncidentsMetric],
                                                ["Asignaciones", incidentsBridge.assignmentsMetric]
                                            ]

                                            delegate: Rectangle {
                                                required property var modelData
                                                width: 120
                                                height: 72
                                                radius: 16
                                                color: "#f7fbff"
                                                border.width: 1
                                                border.color: root.line

                                                Column {
                                                    anchors.centerIn: parent
                                                    spacing: 2

                                                    Text {
                                                        text: modelData[1]
                                                        color: root.ink
                                                        font.family: root.displayFamily()
                                                        font.pixelSize: 26
                                                        font.weight: Font.Bold
                                                    }

                                                    Text {
                                                        text: modelData[0]
                                                        color: root.subInk
                                                        font.family: root.bodyFamily()
                                                        font.pixelSize: 12
                                                    }
                                                }
                                            }
                                        }
                                    }

                                    Row {
                                        width: parent.width
                                        spacing: 10

                                        Repeater {
                                            model: [incidentsBridge.currentLimit, incidentsBridge.currentSeverity, incidentsBridge.currentPeriod]

                                            delegate: Rectangle {
                                                required property string modelData
                                                width: 120
                                                height: 40
                                                radius: 14
                                                color: "#f7fbff"
                                                border.width: 1
                                                border.color: root.line

                                                Text {
                                                    anchors.centerIn: parent
                                                    text: modelData
                                                    color: root.ink
                                                    font.family: root.bodyFamily()
                                                    font.pixelSize: 13
                                                    font.weight: Font.DemiBold
                                                }

                                                MouseArea {
                                                    anchors.fill: parent
                                                    onClicked: {
                                                        if (index === 0) {
                                                            var limits = incidentsBridge.limitOptions
                                                            var currentLimitIndex = limits.indexOf(incidentsBridge.currentLimit)
                                                            incidentsBridge.setLimitFilter(limits[(currentLimitIndex + 1) % limits.length])
                                                        } else if (index === 1) {
                                                            var severities = incidentsBridge.severityOptions
                                                            var currentSeverityIndex = severities.indexOf(incidentsBridge.currentSeverity)
                                                            incidentsBridge.setSeverityFilter(severities[(currentSeverityIndex + 1) % severities.length])
                                                        } else {
                                                            var periods = incidentsBridge.periodOptions
                                                            var currentPeriodIndex = periods.indexOf(incidentsBridge.currentPeriod)
                                                            incidentsBridge.setPeriodFilter(periods[(currentPeriodIndex + 1) % periods.length])
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }

                                    Rectangle {
                                        width: parent.width
                                        height: 42
                                        radius: 14
                                        color: "#f7fbff"
                                        border.width: 1
                                        border.color: root.line

                                        Row {
                                            anchors.fill: parent
                                            anchors.leftMargin: 14
                                            anchors.rightMargin: 14
                                            anchors.verticalCenter: parent.verticalCenter
                                            spacing: 10

                                            Rectangle {
                                                width: 10
                                                height: 10
                                                radius: 5
                                                color: incidentsBridge.busy ? "#c0862d" : "#3a6a95"
                                            }

                                            Text {
                                                text: incidentsBridge.statusMessage
                                                color: root.subInk
                                                font.family: root.bodyFamily()
                                                font.pixelSize: 13
                                            }
                                        }
                                    }

                                    Rectangle {
                                        width: parent.width
                                        height: 46
                                        radius: 15
                                        color: "#102033"

                                        Text {
                                            anchors.centerIn: parent
                                            text: incidentsBridge.busy ? "Actualizando..." : "Actualizar incidencias"
                                            color: "#f4f8fd"
                                            font.family: root.bodyFamily()
                                            font.pixelSize: 14
                                            font.weight: Font.Bold
                                        }

                                        MouseArea {
                                            anchors.fill: parent
                                            enabled: !incidentsBridge.busy
                                            cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                                            onClicked: incidentsBridge.refreshData()
                                        }
                                    }

                                    Rectangle {
                                        width: parent.width
                                        height: parent.height - 286
                                        radius: 18
                                        color: "#f7fbff"
                                        border.width: 1
                                        border.color: root.line

                                        ListView {
                                            id: recordsListView
                                            anchors.fill: parent
                                            anchors.margins: 8
                                            clip: true
                                            spacing: 8
                                            model: incidentsBridge.recordsListModel
                                            currentIndex: incidentsBridge.currentRecordIndex

                                            delegate: Rectangle {
                                                required property int index
                                                required property string title
                                                required property string meta
                                                required property string tag
                                                width: ListView.view.width
                                                height: 84
                                                radius: 16
                                                color: ListView.isCurrentItem ? "#d5e4f3" : "#ffffff"
                                                border.width: 1
                                                border.color: ListView.isCurrentItem ? "#3a6a95" : root.line

                                                Column {
                                                    anchors.fill: parent
                                                    anchors.margins: 14
                                                    spacing: 4

                                                    Text {
                                                        text: title
                                                        color: root.ink
                                                        font.family: root.displayFamily()
                                                        font.pixelSize: 18
                                                        font.weight: Font.Bold
                                                        elide: Text.ElideRight
                                                    }

                                                    Text {
                                                        text: meta
                                                        color: root.subInk
                                                        font.family: root.bodyFamily()
                                                        font.pixelSize: 12
                                                        elide: Text.ElideRight
                                                    }

                                                    Text {
                                                        text: tag
                                                        color: "#3a6a95"
                                                        font.family: root.bodyFamily()
                                                        font.pixelSize: 12
                                                        font.weight: Font.DemiBold
                                                    }
                                                }

                                                MouseArea {
                                                    anchors.fill: parent
                                                    onClicked: {
                                                        recordsListView.currentIndex = index
                                                        incidentsBridge.selectRecord(index)
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            Rectangle {
                                Layout.fillWidth: true
                                Layout.fillHeight: true
                                radius: 22
                                color: "#102033"

                                Flickable {
                                    anchors.fill: parent
                                    anchors.margins: 22
                                    clip: true
                                    contentWidth: width
                                    contentHeight: incidentsPanelContent.implicitHeight

                                    Column {
                                        id: incidentsPanelContent
                                        width: parent.width
                                        spacing: 14

                                        Text {
                                            text: incidentsBridge.selectedIncidentTitle
                                            color: "#f3f8fd"
                                            font.family: root.displayFamily()
                                            font.pixelSize: 34
                                            font.weight: Font.Bold
                                        }

                                        Text {
                                            text: incidentsBridge.selectedIncidentMeta
                                            color: "#9ab8d5"
                                            width: parent.width - 10
                                            wrapMode: Text.WordWrap
                                            font.family: root.bodyFamily()
                                            font.pixelSize: 14
                                        }

                                        Rectangle {
                                            width: parent.width
                                            height: 184
                                            radius: 18
                                            color: "#183049"
                                            border.width: 1
                                            border.color: "#2a4765"

                                            ListView {
                                                id: incidentsListView
                                                anchors.fill: parent
                                                anchors.margins: 8
                                                clip: true
                                                spacing: 8
                                                model: incidentsBridge.incidentsListModel
                                                currentIndex: incidentsBridge.currentIncidentIndex

                                                delegate: Rectangle {
                                                    required property int index
                                                    required property string title
                                                    required property string meta
                                                    required property string tag
                                                    width: ListView.view.width
                                                    height: 84
                                                    radius: 15
                                                    color: ListView.isCurrentItem ? "#2b4763" : "#14283e"
                                                    border.width: 1
                                                    border.color: ListView.isCurrentItem ? "#d0ad72" : "#2a4765"

                                                    Column {
                                                        anchors.fill: parent
                                                        anchors.margins: 14
                                                        spacing: 4

                                                        Text {
                                                            text: title
                                                            color: "#eef5fb"
                                                            font.family: root.displayFamily()
                                                            font.pixelSize: 18
                                                            font.weight: Font.Bold
                                                            elide: Text.ElideRight
                                                        }

                                                        Text {
                                                            text: meta
                                                            color: "#9ab8d5"
                                                            font.family: root.bodyFamily()
                                                            font.pixelSize: 12
                                                            elide: Text.ElideRight
                                                        }

                                                        Text {
                                                            text: tag
                                                            color: "#d0ad72"
                                                            font.family: root.bodyFamily()
                                                            font.pixelSize: 12
                                                            elide: Text.ElideRight
                                                            maximumLineCount: 1
                                                        }
                                                    }

                                                    MouseArea {
                                                        anchors.fill: parent
                                                        onClicked: {
                                                            incidentsListView.currentIndex = index
                                                            incidentsBridge.selectIncident(index)
                                                        }
                                                    }
                                                }
                                            }
                                        }

                                        Row {
                                            spacing: 10

                                            Rectangle {
                                                width: 136
                                                height: 46
                                                radius: 15
                                                color: incidentsBridge.canCreateIncident ? "#d0ad72" : "#8b7a61"
                                                Text { anchors.centerIn: parent; text: "Crear"; color: "#102033"; font.family: root.bodyFamily(); font.pixelSize: 14; font.weight: Font.Bold }
                                                MouseArea { anchors.fill: parent; enabled: incidentsBridge.canCreateIncident; cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor; onClicked: incidentsBridge.createIncident() }
                                            }

                                            Rectangle {
                                                width: 118
                                                height: 46
                                                radius: 15
                                                color: incidentsBridge.canOperateSelectedIncident ? "#f4f8fd" : "#94a8bb"
                                                Text { anchors.centerIn: parent; text: "Subir foto"; color: "#102033"; font.family: root.bodyFamily(); font.pixelSize: 14; font.weight: Font.Bold }
                                                MouseArea { anchors.fill: parent; enabled: incidentsBridge.canOperateSelectedIncident; cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor; onClicked: incidentsBridge.uploadPhoto() }
                                            }

                                            Rectangle {
                                                width: 110
                                                height: 46
                                                radius: 15
                                                color: incidentsBridge.canViewSelectedPhoto ? "#f4f8fd" : "#94a8bb"
                                                Text { anchors.centerIn: parent; text: "Ver foto"; color: "#102033"; font.family: root.bodyFamily(); font.pixelSize: 14; font.weight: Font.Bold }
                                                MouseArea { anchors.fill: parent; enabled: incidentsBridge.canViewSelectedPhoto; cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor; onClicked: incidentsBridge.viewPhoto() }
                                            }

                                            Rectangle {
                                                width: 102
                                                height: 46
                                                radius: 15
                                                color: incidentsBridge.canOperateSelectedIncident ? "#f4f8fd" : "#94a8bb"
                                                Text { anchors.centerIn: parent; text: "Abrir"; color: "#102033"; font.family: root.bodyFamily(); font.pixelSize: 14; font.weight: Font.Bold }
                                                MouseArea { anchors.fill: parent; enabled: incidentsBridge.canOperateSelectedIncident; cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor; onClicked: incidentsBridge.markOpen() }
                                            }

                                            Rectangle {
                                                width: 118
                                                height: 46
                                                radius: 15
                                                color: incidentsBridge.canOperateSelectedIncident ? "#f4f8fd" : "#94a8bb"
                                                Text { anchors.centerIn: parent; text: "En curso"; color: "#102033"; font.family: root.bodyFamily(); font.pixelSize: 14; font.weight: Font.Bold }
                                                MouseArea { anchors.fill: parent; enabled: incidentsBridge.canOperateSelectedIncident; cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor; onClicked: incidentsBridge.markInProgress() }
                                            }

                                            Rectangle {
                                                width: 118
                                                height: 46
                                                radius: 15
                                                color: incidentsBridge.canOperateSelectedIncident ? "#d0ad72" : "#8b7a61"
                                                Text { anchors.centerIn: parent; text: "Resolver"; color: "#102033"; font.family: root.bodyFamily(); font.pixelSize: 14; font.weight: Font.Bold }
                                                MouseArea { anchors.fill: parent; enabled: incidentsBridge.canOperateSelectedIncident; cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor; onClicked: incidentsBridge.markResolved() }
                                            }
                                        }

                                        Rectangle {
                                            width: parent.width
                                            radius: 22
                                            color: "#183049"
                                            border.width: 1
                                            border.color: "#2a4765"
                                            implicitHeight: detailColumn.implicitHeight + 28

                                            Column {
                                                id: detailColumn
                                                anchors.fill: parent
                                                anchors.margins: 14
                                                spacing: 10

                                                Text {
                                                    text: "Detalle"
                                                    color: "#eef5fb"
                                                    font.family: root.displayFamily()
                                                    font.pixelSize: 22
                                                    font.weight: Font.Bold
                                                }

                                                Text {
                                                    text: incidentsBridge.selectedIncidentSummary
                                                    color: "#d8e4f0"
                                                    width: parent.width
                                                    wrapMode: Text.WordWrap
                                                    font.family: root.bodyFamily()
                                                    font.pixelSize: 14
                                                    lineHeight: 1.3
                                                }
                                            }
                                        }

                                        RowLayout {
                                            width: parent.width
                                            spacing: 14

                                            Rectangle {
                                                Layout.fillWidth: true
                                                Layout.preferredHeight: 356
                                                radius: 18
                                                color: "#183049"
                                                border.width: 1
                                                border.color: "#2a4765"

                                                Column {
                                                    anchors.fill: parent
                                                    anchors.margins: 14
                                                    spacing: 10

                                                    Text { text: "Fotos"; color: "#eef5fb"; font.family: root.displayFamily(); font.pixelSize: 20; font.weight: Font.Bold }

                                                    Rectangle {
                                                        width: parent.width
                                                        height: 238
                                                        radius: 14
                                                        color: "#14283e"
                                                        border.width: 1
                                                        border.color: "#2a4765"

                                                        Item {
                                                            anchors.fill: parent
                                                            anchors.margins: 10

                                                            Image {
                                                                anchors.fill: parent
                                                                anchors.margins: 10
                                                                fillMode: Image.PreserveAspectFit
                                                                smooth: true
                                                                asynchronous: true
                                                                source: incidentsBridge.currentPhotoDataUrl
                                                                visible: incidentsBridge.currentPhotoDataUrl !== ""
                                                            }

                                                            Text {
                                                                anchors.centerIn: parent
                                                                text: "Sin preview disponible"
                                                                color: "#9ab8d5"
                                                                font.family: root.bodyFamily()
                                                                font.pixelSize: 13
                                                                visible: incidentsBridge.currentPhotoDataUrl === ""
                                                            }

                                                            Rectangle {
                                                                anchors.left: parent.left
                                                                anchors.leftMargin: 8
                                                                anchors.verticalCenter: parent.verticalCenter
                                                                width: 44
                                                                height: 44
                                                                radius: 22
                                                                color: incidentsBridge.canGoPrevPhoto ? "#f4f8fd" : "#7f91a3"
                                                                opacity: 0.92
                                                                visible: incidentsBridge.currentPhotoDataUrl !== ""

                                                                Text {
                                                                    anchors.centerIn: parent
                                                                    text: "<"
                                                                    color: "#102033"
                                                                    font.family: root.displayFamily()
                                                                    font.pixelSize: 22
                                                                    font.weight: Font.Bold
                                                                }

                                                                MouseArea {
                                                                    anchors.fill: parent
                                                                    enabled: incidentsBridge.canGoPrevPhoto
                                                                    cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                                                                    onClicked: incidentsBridge.prevPhoto()
                                                                }
                                                            }

                                                            Rectangle {
                                                                anchors.right: parent.right
                                                                anchors.rightMargin: 8
                                                                anchors.verticalCenter: parent.verticalCenter
                                                                width: 44
                                                                height: 44
                                                                radius: 22
                                                                color: incidentsBridge.canGoNextPhoto ? "#f4f8fd" : "#7f91a3"
                                                                opacity: 0.92
                                                                visible: incidentsBridge.currentPhotoDataUrl !== ""

                                                                Text {
                                                                    anchors.centerIn: parent
                                                                    text: ">"
                                                                    color: "#102033"
                                                                    font.family: root.displayFamily()
                                                                    font.pixelSize: 22
                                                                    font.weight: Font.Bold
                                                                }

                                                                MouseArea {
                                                                    anchors.fill: parent
                                                                    enabled: incidentsBridge.canGoNextPhoto
                                                                    cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                                                                    onClicked: incidentsBridge.nextPhoto()
                                                                }
                                                            }
                                                        }
                                                    }

                                                    Text {
                                                        text: incidentsBridge.currentPhotoCaption
                                                        color: "#d8e4f0"
                                                        width: parent.width
                                                        elide: Text.ElideRight
                                                        font.family: root.bodyFamily()
                                                        font.pixelSize: 12
                                                    }

                                                    Row {
                                                        spacing: 10

                                                        Rectangle {
                                                            width: 88
                                                            height: 40
                                                            radius: 14
                                                            color: "#14283e"
                                                            border.width: 1
                                                            border.color: "#35516d"
                                                            Text { anchors.centerIn: parent; text: incidentsBridge.currentPhotoCounter; color: "#eef5fb"; font.family: root.bodyFamily(); font.pixelSize: 13; font.weight: Font.DemiBold }
                                                        }

                                                        Text {
                                                            text: "Desliza con anterior y siguiente para revisar evidencia."
                                                            color: "#9ab8d5"
                                                            font.family: root.bodyFamily()
                                                            font.pixelSize: 12
                                                            verticalAlignment: Text.AlignVCenter
                                                        }
                                                    }
                                                }
                                            }

                                            Rectangle {
                                                Layout.fillWidth: true
                                                Layout.preferredHeight: 356
                                                radius: 18
                                                color: "#183049"
                                                border.width: 1
                                                border.color: "#2a4765"

                                                Column {
                                                    anchors.fill: parent
                                                    anchors.margins: 14
                                                    spacing: 10

                                                    Text { text: "Asignaciones"; color: "#eef5fb"; font.family: root.displayFamily(); font.pixelSize: 20; font.weight: Font.Bold }

                                                    ListView {
                                                        anchors.left: parent.left
                                                        anchors.right: parent.right
                                                        height: 160
                                                        clip: true
                                                        spacing: 8
                                                        model: incidentsBridge.assignmentsListModel

                                                        delegate: Rectangle {
                                                            required property string title
                                                            required property string meta
                                                            required property string tag
                                                            width: ListView.view.width
                                                            height: 62
                                                            radius: 14
                                                            color: "#14283e"
                                                            border.width: 1
                                                            border.color: "#2a4765"

                                                            Column {
                                                                anchors.fill: parent
                                                                anchors.margins: 12
                                                                spacing: 2

                                                                Text { text: title; color: "#eef5fb"; font.family: root.bodyFamily(); font.pixelSize: 13; font.weight: Font.DemiBold; elide: Text.ElideRight }
                                                                Text { text: (meta ? meta + " - " : "") + tag; color: "#9ab8d5"; font.family: root.bodyFamily(); font.pixelSize: 11; elide: Text.ElideRight }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    Item {
                        anchors.fill: parent
                        anchors.margins: 18
                        visible: root.currentScreen === 2

                        Column {
                            anchors.fill: parent
                            spacing: 18

                            Text {
                                text: "Historial / reportes"
                                color: root.ink
                                font.family: root.displayFamily()
                                font.pixelSize: 36
                                font.weight: Font.Bold
                            }

                            RowLayout {
                                width: parent.width
                                spacing: 18

                                Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 220; radius: 22; color: root.card; border.width: 1; border.color: root.line }
                                Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 220; radius: 22; color: root.cardSoft; border.width: 1; border.color: root.line }
                            }

                            Rectangle { width: parent.width; height: 260; radius: 24; color: root.card; border.width: 1; border.color: root.line }
                        }
                    }

                    Item {
                        anchors.fill: parent
                        anchors.margins: 18
                        visible: root.currentScreen === 3

                        RowLayout {
                            anchors.fill: parent
                            spacing: 18

                            Rectangle { Layout.preferredWidth: 420; Layout.fillHeight: true; radius: 22; color: root.cardSoft; border.width: 1; border.color: root.line }
                            Rectangle { Layout.fillWidth: true; Layout.fillHeight: true; radius: 22; color: root.card; border.width: 1; border.color: root.line }
                        }
                    }
                }
            }
        }
    }
}
