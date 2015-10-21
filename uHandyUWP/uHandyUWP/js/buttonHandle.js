// 處理按鈕事件函式

function getToggleRulerButton_clicked() {
    $("#toggleRuler > i").css('color', 'gray');
}
function getToggleRulerButton_tapped() {
    $("#rulerInfo").toggle();
    $("#toggleRuler > i").css('color', 'white');
}

function getStartCanvas_clicked() {
    var flag = $("#canvasStart").data('myvalue');
    if (flag == 0) {
        $("#canvasStart > i").css('color', 'gray');
    } else {
        $("#canvasStart > i").css('color', 'pink');
    }
}
function getStartCanvas_tapped() {
    var flag = $("#canvasStart").data('myvalue');
    if (flag == 0) {
        $("#canvasStart > i").css('color', 'red');
        $("#rulerInfo").hide();
        $("#toggleRuler").hide();
        initInkCanvas();
        $("#canvasStart").data('myvalue', 1);
        $("#inkdraw").show();
    } else {
        $("#canvasStart > i").css('color', 'white');
        $("#toggleRuler").show();
        $("#inkdraw").hide();
        $("#canvasStart").data('myvalue', 0);
    }
}

function getTouchClick() {
    console.log('click By User');
    var touchCapabilities = new Windows.Devices.Input.TouchCapabilities();

    //console.log("touchPresent " + touchCapabilities.touchPresent ); 
    //console.log("contacts " + touchCapabilities.contacts );

}

function getZoomButtonClick() {
    console.log("getZoomButtonClick");
    var videoDev = oMediaCapture.videoDeviceController;
    var focusValueMax = null;
    var focusValueMin = null;
    var focusValueNow = null;
    var focusValueStep = null;

    if (isInitialized) {
        if (isPreviewing) {
            focusValueNow = videoDev.focus.tryGetValue().value;
            focusValueStep = videoDev.focus.capabilities.step;
            focusValueMin = videoDev.focus.capabilities.min;
            focusValueMax = videoDev.focus.capabilities.max;
            //console.log( 'set = ' + videoDev.contrast.trySetAuto(true) );
            //zoomSet.Mode = Windows.Media.Devices.ZoomTransitionMode.Auto;
            //zoomSet.Value = zoomValueNow + zoomValueStep;
            //videoDev.zoomControl.configure(zoomSet);

            console.log('set state = ' + videoDev.focus.trySetValue(focusValueNow + focusValueStep));
        }
    }
}

function getPreviewFrameButton_clicked() {
    $('#getPreviewFrameButton > i').css('color', 'gray');
}
function getPreviewFrameButton_tapped() {
    // 如果沒有在 preview 中，則無法取得畫面
    if (!isPreviewing) {
        return;
    }
    $('#getPreviewFrameButton > i').css('color', 'white');
    // 取得照片Preview及顯示/隱藏 必要的按鍵
    getPreviewFrameAsSoftwareBitmapAsync().done();
    $('.senerio-preview').hide();
    $('.senerio-pictureLibrary').hide();
    $('.senerio-handlePicture').show();
    $('#pictureLibrary').data('myvalue', 1);
}

function getShare_clicked() {
    $('#getShare > i').css('color', 'gray');
}
function getShare_tapped() {
    $('#getShare > i').css('color', 'white');
    WinJS.Promise.join({})
    .then(function () {
        $('#cameraDiv').css('padding-bottom', '0px');
        return;
    })
    .then(function () {
        Windows.ApplicationModel.DataTransfer.DataTransferManager.showShareUI();
        return;
    })
    .then(function () {
        $('#cameraDiv').css('padding-bottom', '50px');
    }).done();
}
function getPictureLibrary_clicked() {
    $('#pictureLibrary > i').css('color', 'gray');
}
function getPictureLibrary_tapped() {
    $('#pictureLibrary > i').css('color', 'white');
    var flag = $("#pictureLibrary").data('myvalue');
    if (flag == 0) {
        $('.senerio-handlePicture').hide();
        $('.senerio-preview').hide();
        $('.senerio-pictureLibrary').show();
        $("#pictureLibrary").data('myvalue', 1);
    } else {
        $('.senerio-handlePicture').hide();
        $('.senerio-pictureLibrary').hide();
        $('.senerio-preview').show();
        $("#pictureLibrary").data('myvalue', 0)
    }
}
function initInkCanvas() {
    $('#inkdraw').show();
    var inkManager = new Windows.UI.Input.Inking.InkManager();
    var inkCanvas = document.getElementById("inkdraw");
    inkCanvas.setAttribute("width", inkCanvas.offsetWidth);
    inkCanvas.setAttribute("height", inkCanvas.offsetHeight);
    var inkContext = inkCanvas.getContext("2d");
    var pointerDeviceType = null;
    var pointerId = -1;

    var getPointerDeviceType = function (pId) {
        var pointerPoint = Windows.UI.Input.PointerPoint.getCurrentPoint(pId);
        switch (pointerPoint.pointerDevice.pointerDeviceType) {
            case Windows.Devices.Input.PointerDeviceType.touch:
                pointerDeviceType = "Touch";
                break;

            case Windows.Devices.Input.PointerDeviceType.pen:
                pointerDeviceType = "Pen";
                break;

            case Windows.Devices.Input.PointerDeviceType.mouse:
                pointerDeviceType = "Mouse";
                break;
            default:
                pointerDeviceType = "Undefined";
        }
        return pointerDeviceType;
    };

    var onPointerDown = function (evt) {

        // Get the device type for the pointer input.
        pointerDeviceType = getPointerDeviceType(evt.pointerId);

        // Process pen and mouse (with left button) only. Reserve touch for manipulations.
        if ((pointerDeviceType === "Pen") || (pointerDeviceType === "Touch") || ((pointerDeviceType === "Mouse") && (evt.button === 0))) {
            console.log(pointerDeviceType + " pointer down: Start stroke. ");

            // Process one pointer at a time.
            if (pointerId === -1) {
                var current = evt.currentPoint;

                // Start drawing the stroke.
                inkContext.beginPath();
                inkContext.lineWidth = '1';
                inkContext.strokeStyle = 'blue';
                inkContext.lineCap = "round";
                inkContext.lineJoin = "round";
                inkContext.moveTo(current.rawPosition.x, current.rawPosition.y);

                // Add current pointer to the ink manager (begin stroke).
                inkManager.processPointerDown(current);

                // The pointer id is used to restrict input processing to the current stroke.
                pointerId = evt.pointerId;
            }
        }
        else {
            // Process touch input.
        }
    };

    var onPointerMove = function (evt) {
        // Process pen and mouse (with left button) only. Reserve touch for manipulations.
        if ((pointerDeviceType === "Pen") || (pointerDeviceType === "Touch") || ((pointerDeviceType === "Mouse") && (evt.button === -1))) {

            // The pointer Id is used to restrict input processing to the current stroke.
            // pointerId is updated in onPointerDown().
            if (evt.pointerId === pointerId) {
                var current = evt.currentPoint;
                // Draw stroke in real time.
                inkContext.lineTo(current.rawPosition.x, current.rawPosition.y);
                inkContext.stroke();

                // Add current pointer to the ink manager (update stroke).
                inkManager.processPointerUpdate(current);
            }
        }
        else {
            // Process touch input.
        }
    };

    var onPointerUp = function (evt) {
        // Process pen and mouse (with left button) only. Reserve touch for manipulations.
        if ((pointerDeviceType === "Pen") || (pointerDeviceType === "Touch") || ((pointerDeviceType === "Mouse") && (evt.button === 0))) {
            console.log(pointerDeviceType + " pointer up: Finish stroke. ");
            if (evt.pointerId === pointerId) {
                // Add current pointer to the ink manager (end stroke).
                inkManager.processPointerUp(evt.currentPoint);

                // End live drawing.
                inkContext.closePath();

                // Render strokes using bezier curves.
                //renderAllStrokes();

                // Reset pointer Id.
                pointerId = -1;
            }
        }
        else {
            // Process touch input.
        }
    };

    var renderAllStrokes = function () {
        // Iterate through each stroke.
        inkManager.getStrokes().forEach(
            function (stroke) {
                inkContext.beginPath();
                if (stroke.selected) {
                    inkContext.lineWidth = stroke.drawingAttributes.size.width * 2;
                    inkContext.strokeStyle = "green";
                } else {
                    inkContext.lineWidth = stroke.drawingAttributes.size.width;
                    inkContext.strokeStyle = "black";
                }

                // Enumerate through each line segment of the stroke.
                var first = true;

                stroke.getRenderingSegments().forEach(
                    function (segment) {
                        // Move to the starting screen location of the stroke.
                        if (first) {
                            inkContext.moveTo(segment.position.x, segment.position.y);
                            first = false;
                        }
                            // Calculate the bezier curve for the segment.
                        else {
                            inkContext.bezierCurveTo(segment.bezierControlPoint1.x,
                                                     segment.bezierControlPoint1.y,
                                                     segment.bezierControlPoint2.x,
                                                     segment.bezierControlPoint2.y,
                                                     segment.position.x, segment.position.y);
                        }
                    }
                );

                // Draw the stroke.
                inkContext.stroke();
                inkContext.closePath();
            }
        );
    };

    // Set up the handlers for input processing.
    inkCanvas.addEventListener("pointerdown", onPointerDown);
    inkCanvas.addEventListener("pointermove", onPointerMove);
    inkCanvas.addEventListener("pointerup", onPointerUp);

}
