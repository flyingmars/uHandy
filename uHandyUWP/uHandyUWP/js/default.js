//如需空白範本的簡介，請參閱下列文件: 
//http://go.microsoft.com/fwlink/?LinkId=232509
(function () {
	"use strict";
	var Capture = Windows.Media.Capture;
	var DeviceInformation = Windows.Devices.Enumeration.DeviceInformation;
	var DeviceClass = Windows.Devices.Enumeration.DeviceClass;
	var DisplayOrientations = Windows.Graphics.Display.DisplayOrientations;
	var Imaging = Windows.Graphics.Imaging;
	var Media = Windows.Media;

    // 收到關於介面或裝置的旋轉通知，並作對應的動作。
	var oDisplayInformation = Windows.Graphics.Display.DisplayInformation.getForCurrentView(),
        oDisplayOrientation = DisplayOrientations.portrait;

    // 當照相機工作時，防止休眠
	var oDisplayRequest = new Windows.System.Display.DisplayRequest();

    // 監聽媒體性質的改變
	var oSystemMediaControls = Media.SystemMediaTransportControls.getForCurrentView();

    // 媒體裝置與狀態參數
	var oMediaCapture = null,
        isInitialized = false,
        isPreviewing = false,
        isRecording = false ;

    // 相機裝置的資訊
	var externalCamera = false,
        mirroringPreview = false;

    // 旋轉的原始資料，以便應用於串流(MF_MT_VIDEO_ROTATION)
    // 參考連結: http://msdn.microsoft.com/en-us/library/windows/apps/xaml/hh868174.aspx
	var RotationKey = "C380465D-2271-428C-9B83-ECEA3B4A85C1";

    // Windows App 必要參數
	var app = WinJS.Application;
	var activation = Windows.ApplicationModel.Activation;

    // 觸控事件參數
	var oGestureHandler;

	app.onactivated = function (args) {
		if (args.detail.kind === activation.ActivationKind.launch) {
			if (args.detail.previousExecutionState !== activation.ApplicationExecutionState.terminated) {
			    // 此應用程式已全新啟動。請在這裡初始化應用程式。

                // 按鈕註冊
			    $("#getPreviewFrameButton")
                    .mousedown(getPreviewFrameButton_clicked)
                    .mouseup(getPreviewFrameButton_tapped);
			    $("#zoomTestButton").click(getZoomButtonClick);
			    $("#toggleRuler")
                    .mousedown(getToggleRulerButton_clicked)
                    .mouseup(getToggleRulerButton_tapped);
			    $('#cameraPreview').resize(resizeHandler);

                // Preview 位址
			    previewFrameImage.src = null;
			}
            // 視窗事件註冊
			oDisplayInformation.addEventListener("orientationchanged", displayInformation_orientationChanged);
			initializeCameraAsync();
			args.setPromise(WinJS.UI.processAll());

		    // 觸控
			document.getElementById('cameraDiv').addEventListener('click',getTouchClick,false);
			initGestureHandler();

            // 尺標
			$('#rulerInfo').draggable();
			resizeHandler();

		} else {
		    // 此應用程式已被暫停並終止。
		    // 若要建立流暢的使用者體驗，請在此還原應用程式狀態，以便讓應用程式看起來像是從未停止執行一樣。
		    oDisplayInformation.addEventListener("orientationchanged", displayInformation_orientationChanged);
		    initializeCameraAsync();
		}
	};

	app.oncheckpoint = function (args) {
		// 此應用程式即將暫停。請在這裡儲存必須在暫停期間保留的所有狀態。
		// 您可以使用 WinJS.Application.sessionState 物件，此物件會自動儲存並在暫停期間還原。
	    // 若您需要在應用程式暫停之前先完成非同步作業，請呼叫 args.setPromise()。
	    oDisplayInformation.removeEventListener("orientationchanged", displayInformation_orientationChanged);
	    args.setPromise(cleanupCameraAsync());
	};

	app.onunload = function (args) {
	    oDisplayInformation.removeEventListener("orientationchanged", displayInformation_orientationChanged);
	    document.getElementById("getPreviewFrameButton").removeEventListener("click", getPreviewFrameButton_tapped);
	    oSystemMediaControls.removeEventListener("propertychanged", systemMediaControls_PropertyChanged);

	    args.setPromise(cleanupCameraAsync());
	};

    // 自己建立的函數
	function resizeHandler() {
	    // 尺規校正
	    var zoomScale = oMediaCapture ? oMediaCapture.videoDeviceController.zoom.tryGetValue().value * 450/500 : 0 ;
	    var scaleCorrect = $('#cameraPreview').css('transform').split(',')[3] || 1;
	    var originRatio = 100;
	    var displayWidth = document.getElementById('cameraPreview').clientWidth;
	    var rulerWidth = document.getElementById('rulerInfo').clientWidth;
	    var displayValue = Math.round( (displayWidth / scaleCorrect / rulerWidth * originRatio -zoomScale)/ 10) * 10;
	    $('#rulerInfo > .rulerNum').html(displayValue + ' ㎛');
	    console.log('resize = ' + zoomScale);
	}

	function initGestureHandler() {
	    var myGesture = new MSGesture();
	    var elm = document.getElementById("cameraDiv");
        
	    myGesture.target = elm;

	    var handleGesture = null;
        var pointerListener = function (evt) {
            myGesture.addPointer(evt.pointerId);
        };

        var zoomHandler = function (evt) {
            var videoDev  = oMediaCapture.videoDeviceController;
            var valueNow  = videoDev.zoom.tryGetValue().value;
            var valueStep = videoDev.zoom.capabilities.step;
            var valueMin  = videoDev.zoom.capabilities.min;
            var valueMax  = videoDev.zoom.capabilities.max;

            var tryToSet  = Math.round( evt.scale * valueNow) % valueStep ;
            tryToSet = Math.round(evt.scale * evt.scale * evt.scale * valueNow) - tryToSet;

//            console.log('evt=' + evt.scale + ' want to ' + (valueNow + valueStep));
            if (evt.scale > 1.0 && (valueNow + valueStep*2) <= valueMax) {
                videoDev.zoom.trySetValue(valueNow + valueStep *2);
                console.log('set state = ' + ( valueNow + valueStep ));
            } else if (evt.scale < 1.0 && (valueNow - valueStep*2) >= valueMin) {
                videoDev.zoom.trySetValue(valueNow - valueStep*2);
                console.log('set state = ' + (valueNow - valueStep));
            }
            resizeHandler();
        }

        var softwareZoom = function (evt) {
            var currentScale = $('#cameraPreview').css('transform').split(',')[3];
            
            if (currentScale) {
                var newScale = evt.scale * currentScale;
                newScale = (newScale < 1.0) ? 1.0 : newScale;
                $('#cameraPreview').css('transform', 'scale(' + newScale + ')');
                resizeHandler();
                console.log('currentScale ' + currentScale);
            } else {
                if (evt.scale >= 1) {
                    $('#cameraPreview').css('transform', 'scale(' + evt.scale + ')');
                    resizeHandler();
                }   
            }
        };
        
        elm.addEventListener("MSGestureChange", zoomHandler);
	    elm.addEventListener("pointerdown", pointerListener);

	}

    // 處理按鈕事件函式

	function getToggleRulerButton_clicked() {
	    $("#toggleRuler > i").css('color','gray');
	}
	function getToggleRulerButton_tapped() {
	    $("#rulerInfo").toggle();
	    $("#toggleRuler > i").css('color', 'white');
	}

	function getTouchClick() {
	    console.log('click By User');
	    var touchCapabilities = new Windows.Devices.Input.TouchCapabilities();

	    //console.log("touchPresent " + touchCapabilities.touchPresent ); 
	    //console.log("contacts " + touchCapabilities.contacts );

	}

	function getZoomButtonClick() {
	    console.log("getZoomButtonClick");
	    var videoDev = oMediaCapture.videoDeviceController ;
	    var focusValueMax = null;
	    var focusValueMin = null;
	    var focusValueNow = null;
	    var focusValueStep = null;
	    var zoomSet = new Windows.Media.Devices.ZoomSettings();

	    if (isInitialized) {
	        if (isPreviewing) {
	            focusValueNow = videoDev.zoom.tryGetValue().value;
	            focusValueStep = videoDev.zoom.capabilities.step;
	            focusValueMin = videoDev.zoom.capabilities.min ;
	            focusValueMax = videoDev.zoom.capabilities.max;
	            //console.log( 'set = ' + videoDev.contrast.trySetAuto(true) );
	            //zoomSet.Mode = Windows.Media.Devices.ZoomTransitionMode.Auto;
	            //zoomSet.Value = zoomValueNow + zoomValueStep;
	            //videoDev.zoomControl.configure(zoomSet);
                
	            console.log('set state = ' + videoDev.zoom.trySetValue(focusValueNow + focusValueStep));
	        }
	    }
	}

	function getPreviewFrameButton_clicked(){
	    $('#getPreviewFrameButton > i').css('color','gray');
	}

	function getPreviewFrameButton_tapped() {
	    // 如果沒有在 preview 中，則無法取得畫面
	    if (!isPreviewing) {
	        return;
	    }
	    $('#getPreviewFrameButton > i').css('color', 'white');
	    getPreviewFrameAsSoftwareBitmapAsync().done();
	    
	}

    /// <summary>
    /// 初始化相機，註冊事件，取得相機鏡射、旋轉的資訊，開始預覽並對UI解鎖。
    /// </summary>
    /// <returns></returns>
	function initializeCameraAsync() {
	    console.log("InitializeCameraAsync");

	    // 取得可以照相的裝置
	    return findCameraDeviceByPanelAsync(Windows.Devices.Enumeration.Panel.back)
        .then(function (camera) {
            if (!camera) {
                console.log("No camera device found!");
                return;
            }
            // 尋找相機的位置
            if (!camera.enclosureLocation || camera.enclosureLocation.panel === Windows.Devices.Enumeration.Panel.unknown) {
                // 沒有相機的位置資訊，假設是外接相機，非內建相機。
                externalCamera = true;
            } else {
                // 內建相機
                externalCamera = false;

                // 如果為前置鏡頭，鏡射影像。
                mirroringPreview = (camera.enclosureLocation.panel === Windows.Devices.Enumeration.Panel.front);
            }

            oMediaCapture = new Capture.MediaCapture();

            // 註冊事件，當有問題發生時可以處理
            oMediaCapture.addEventListener("failed", mediaCapture_failed);

            var settings = new Capture.MediaCaptureInitializationSettings();
            settings.videoDeviceId = camera.id;

            // 初始化裝置並開始預覽
            return oMediaCapture.initializeAsync(settings);
        }).then(function () {
            isInitialized = true;
            oMediaCapture.videoDeviceController.zoom.trySetValue(1);
            return startPreviewAsync();
        }, function (error) {
            console.log(error.message);
        }).done();
	}

    /// <summary>
    /// 清除相機資源 (在錄影或停止預覽之後) ，並取消註冊事件
    /// </summary>
    /// <returns></returns>
	function cleanupCameraAsync() {
	    console.log("cleanupCameraAsync");

	    var promiseList = {};

	    if (isInitialized) {
	        if (isPreviewing) {
	            // 在此完成停止預覽，但要安全地移除裝置的話，要用MediaCapture.close() 移除，這在稍後會做到。
	            // 但在此會開始停止預覽。
	            stopPreview();
	        }

	        isInitialized = false;
	    }

	    // 當所有工作都完成時，清除 MediaCapture
	    return WinJS.Promise.join(promiseList)
        .then(function () {
            if (oMediaCapture != null) {
                oMediaCapture.removeEventListener("failed", mediaCapture_failed);
                oMediaCapture.close();
                oMediaCapture = null;
            }
        });
	}

    /// <summary>
    /// 開始預覽、保持螢幕開啟，並調整旋轉與鏡射。
    /// </summary>
	function startPreviewAsync() {
	    // 防止螢幕休眠
	    oDisplayRequest.requestActive();

	    // 註冊Property改變的監聽事件
	    oSystemMediaControls.addEventListener("propertychanged", systemMediaControls_PropertyChanged);

	    // 設定預覽的src，如果需要的話使其鏡像
	    var previewVidTag = document.getElementById("cameraPreview");
	    if (mirroringPreview) {
	        cameraPreview.style.transform = "scale(-1, 1)";
	    }
	    try{
	        var previewUrl = URL.createObjectURL(oMediaCapture)
	        previewVidTag.src = previewUrl;
	        previewVidTag.play();
	    
	        previewVidTag.addEventListener("playing", function () {
	            isPreviewing = true;
	            setPreviewRotationAsync();
	        });
	    } catch (e) {
	        console.log(e.message);
	    }
	}

    /// <summary>
    /// 取得現在UI對於裝置的方向性 ( 當 AutoRotationPreferences 無法完成 ) 並正確的旋轉預覽
    /// </summary>
    /// <returns></returns>
	function setPreviewRotationAsync() {
	    // 當相機附在裝置上時，只需要更新方向性
	    if (externalCamera) {
	        return WinJS.Promise.as();
	    }

	    // 計算旋轉預覽的方向與角度
	    var rotationDegrees = convertDisplayOrientationToDegrees(oDisplayOrientation);

	    // 如果已被鏡像的話，則需要翻轉
	    if (mirroringPreview) {
	        rotationDegrees = (360 - rotationDegrees) % 360;
	    }

	    // 在預覽串流中加入旋轉的原始資料以確保aspect ratio / dimensions在取得預覽畫面及render時可以配合
	    var props = oMediaCapture.videoDeviceController.getMediaStreamProperties(Capture.MediaStreamType.videoPreview);
	    props.properties.insert(RotationKey, rotationDegrees);
	    return oMediaCapture.setEncodingPropertiesAsync(Capture.MediaStreamType.videoPreview, props, null);
	}

    /// <summary>
    /// 停止預覽並解除顯示要求，以利螢幕進入省電模式
    /// </summary>
    /// <returns></returns>
	function stopPreview() {
	    isPreviewing = false;

	    // Cleanup the UI
	    var previewVidTag = document.getElementById("cameraPreview");
	    previewVidTag.pause();
	    previewVidTag.src = null;

	    // Allow the device screen to sleep now that the preview is stopped
	    oDisplayRequest.requestRelease();
	}

    /// <summary>
    /// 取得目前的Preview畫面，變成Bitmap，在Textblock中顯示properties，可以選擇是否要顯畫面，或/且存jpg在磁碟中。
    /// </summary>
    /// <returns></returns>
	function getPreviewFrameAsSoftwareBitmapAsync() {
	    // 取得 Preview 的資訊
	    var previewProperties = oMediaCapture.videoDeviceController.getMediaStreamProperties(Capture.MediaStreamType.videoPreview);
	    var videoFrameWidth = previewProperties.width;
	    var videoFrameHeight = previewProperties.height;

	    // 創立一個影格以用來要求一個 SoftwareBitmap preview frame
	    var videoFrame = new Windows.Media.VideoFrame(Imaging.BitmapPixelFormat.bgra8, videoFrameWidth, videoFrameHeight);

	    // 擷取一個影格
	    return oMediaCapture.getPreviewFrameAsync(videoFrame)
        .then(function (currentFrame) {
            // 蒐集影格的結果
            var frameBitmap = currentFrame.softwareBitmap;
            
            // 顯示影格資訊
            console.log( frameBitmap.pixelWidth + "x" + frameBitmap.pixelHeight + " " +
                stringOfEnumeration(Windows.Graphics.DirectX.DirectXPixelFormat, frameBitmap.bitmapPixelFormat) );
            
            // 儲存、顯示影格（無旋轉）
            return saveAndShowSoftwareBitmapAsync(frameBitmap);
            /*
            if (saveShowFrameCheckBox.checked === true) {
                return saveAndShowSoftwareBitmapAsync(frameBitmap);
            }
            else {
                return WinJS.Promise.as();
            }*/
        }, function (error) {
            console.log(error.message);
        });
	}

    /// <summary>
    /// 取得目前的Preview frame，把他當成 Direct3DSurface，並在 TextBlock 顯示性質
    /// </summary>
    /// <returns></returns>
	function getPreviewFrameAsD3DSurfaceAsync() {
	    // 取得 preview frame ，當做是 D3D surface
	    return oMediaCapture.getPreviewFrameAsync()
        .then(function (currentFrame) {
            // 確定 Direct3DSurface 非 null（也有可能是裝置不支援取得影格當做D3D surface）
            if (currentFrame.direct3DSurface != null) {
                // 蒐集結果影格
                var surface = currentFrame.direct3DSurface;

                // 顯示影格資訊
                frameInfoTextBlock.textContent = surface.description.width + "x" + surface.description.height + " " +
                    stringOfEnumeration(Windows.Graphics.DirectX.DirectXPixelFormat, surface.description.format);
            }
            else { // 不能用D3D，使用軟體Bitmap
                // 蒐集結果影格
                var frameBitmap = currentFrame.softwareBitmap;

                // 顯示影格資訊
                frameInfoTextBlock.textContent = frameBitmap.pixelWidth + "x" + frameBitmap.pixelHeight + " " +
                    stringOfEnumeration(Windows.Graphics.DirectX.DirectXPixelFormat, frameBitmap.bitmapPixelFormat);
            }

            // 清除影像
            previewFrameImage.src = null;
        }, function (error) {
            console.log(error.message)
        });
	}

    /// <summary>
    /// 把 SoftwareBitmap 用一個獨特的名字儲存到 Pictures library
    /// </summary>
    /// <param name="bitmap"></param>
    /// <returns></returns>
	function saveAndShowSoftwareBitmapAsync(bitmap) {
	    console.log(bitmap);
	    var oFile = null;
	    return Windows.Storage.KnownFolders.picturesLibrary.createFileAsync("uHandy.jpg", Windows.Storage.CreationCollisionOption.generateUniqueName)
        .then(function (file) {
            oFile = file;
            return file.openAsync(Windows.Storage.FileAccessMode.readWrite);
        }).then(function (outputStream) {
            return Imaging.BitmapEncoder.createAsync(Imaging.BitmapEncoder.jpegEncoderId, outputStream);
        }).then(function (encoder) {
            // 從 SoftwareBitmap 取得資料
            
            encoder.setSoftwareBitmap(bitmap);
            return encoder.flushAsync();
        }).done(function () {
            // 最後用正確的方向顯示影像
            previewFrameImage.src = oFile.path;
            previewFrameImage.style.transform = "rotate(" + convertDisplayOrientationToDegrees(oDisplayOrientation) + "deg)";
        });
	}


    /// <summary>
    /// 嘗試尋找並回傳一個本機裝置，或是找不到的話回傳表單中第一個裝置
    /// </summary>
    /// <param name="panel">回傳的裝置必須是掛載的裝置</param>
    /// <returns></returns>
	function findCameraDeviceByPanelAsync(panel) {
	    var deviceInfo = null;
	    // 取得可以截取畫面的裝置
	    return DeviceInformation.findAllAsync(DeviceClass.videoCapture)
        .then(function (devices) {
            devices.forEach(function (cameraDeviceInfo) {
                if (cameraDeviceInfo.enclosureLocation != null && cameraDeviceInfo.enclosureLocation.panel === panel) {
                    deviceInfo = cameraDeviceInfo;
                    return;
                }
            });

            // 什麼都沒找到，回傳第一個
            if (!deviceInfo && devices.length > 0) {
                deviceInfo = devices.getAt(0);
            }

            return deviceInfo;
        });
	}

    /// <summary>
    /// 算出需轉換的角度，在給定APP的方向性下
    /// </summary>
    /// <param name="orientation"> APP 的 Orientation </param>
    /// <returns>An orientation in degrees</returns>
	function convertDisplayOrientationToDegrees(orientation) {
	    switch (orientation) {
	        case DisplayOrientations.portrait:
	            return 0;
	        case DisplayOrientations.landscapeFlipped:
	            return 90;
	        case DisplayOrientations.portraitFlipped:
	            return 180;
	        case DisplayOrientations.landscape:
	        default:
	            return 270;
	    }
	}

    /// <summary>
    /// 當頁面旋轉的時候，且 DisplayInformation.AutoRotationPreferences 的值無法在 setupUiAsync() 中被完成時，會激發這個事件。
    /// </summary>
    /// <param name="sender">事件來源</param>
	function displayInformation_orientationChanged(args) {
	    oDisplayOrientation = args.target.currentOrientation;

	    if (isPreviewing) {
	        setPreviewRotationAsync();
	    }
	}

	function getRecord_tapped() {
	    var promiseToExecute = null;
	    if (!isRecording) {
	        promiseToExecute = startRecordingAsync();
	    }
	    else {
	        promiseToExecute = stopRecordingAsync();
	    }

	    promiseToExecute
        .then(function () {
            updateCaptureControls();
        }, function (error) {
            console.log(error.message);
        }).done();
	}

	function startRecordingAsync() {
	    return Windows.Storage.KnownFolders.picturesLibrary.createFileAsync("SimpleVideo.mp4", Windows.Storage.CreationCollisionOption.generateUniqueName)
        .then(function (file) {
            // 計算旋轉角度，在必要時鏡射
            var rotationAngle = 360 - convertDeviceOrientationToDegrees(getCameraOrientation());
            var encodingProfile = Windows.Media.MediaProperties.MediaEncodingProfile.createMp4(Windows.Media.MediaProperties.VideoEncodingQuality.auto);
            encodingProfile.video.properties.insert(RotationKey, rotationAngle);

            console.log("Starting recording...");
            return oMediaCapture.startRecordToStorageFileAsync(encodingProfile, file)
            .then(function () {
                isRecording = true;
                console.log("Started recording!");
            });
        });
	}


    /// <summary>
    /// 在APP被最小化的事件中，這個方法可以處理媒體性質改變。如果APP收到一個 mute notification，則此APP就不會在前景
    /// </summary>
    /// <param name="args"></param>
	function systemMediaControls_PropertyChanged(args) {
	    // 檢查APP是不是被 muted。如果是的話，則被最小化了。
	    // 否則，就是還沒被初始化，正準備放到主畫面（focus）
	    if (args.target.soundLevel === Media.SoundLevel.muted) {
	        cleanupCameraAsync();
	    }
	    else if (!isInitialized) {
	        initializeCameraAsync();
	    }
	}

	function mediaCapture_failed(errorEventArgs) {
	    console.log("MediaCapture_Failed: 0x" + errorEventArgs.code + ": " + errorEventArgs.message);

	    cleanupCameraAsync().done();
	}

    /// <summary>
    /// 轉換 enum 至可讀的字串
    /// </summary>
    /// <param name="enumeration">Enumeration</param>
    /// <param name="enumeration">enumeration的值</param>
    /// <returns>enumeration value轉換出的字串</returns>
	function stringOfEnumeration(enumeration, value) {
	    for (var k in enumeration) if (enumeration[k] == value) {
	        return k;
	    }
	    return null;
	}

	app.start();
})();
