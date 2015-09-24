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

	var app = WinJS.Application;
	var activation = Windows.ApplicationModel.Activation;

	app.onactivated = function (args) {
		if (args.detail.kind === activation.ActivationKind.launch) {
			if (args.detail.previousExecutionState !== activation.ApplicationExecutionState.terminated) {
			    // 此應用程式已全新啟動。請在這裡初始化應用程式。
			    document.getElementById("getPreviewFrameButton").addEventListener("click", getPreviewFrameButton_tapped);
			    document.getElementById("zoomTestButton").addEventListener("click", getZoomButtonClick);
			    previewFrameImage.src = null;
			}
			oDisplayInformation.addEventListener("orientationchanged", displayInformation_orientationChanged);
			initializeCameraAsync();
			args.setPromise(WinJS.UI.processAll());

		    // Test for touch
			document.getElementById('cameraDiv').addEventListener('click',getTouchClick,false);
			$('#ruler').draggable();
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

	function getTouchClick() {
	    console.log('click By User');
	    var touchCapabilities = new Windows.Devices.Input.TouchCapabilities();

	    console.log("touchPresent " + touchCapabilities.touchPresent ); 
	    console.log("contacts " + touchCapabilities.contacts );

	}

	function getZoomButtonClick() {
	    console.log("getZoomButtonClick");
	    var videoDev = oMediaCapture.videoDeviceController ;
	    var zoomValueMax = null;
	    var zoomValueMin = null;
	    var zoomValueNow = null;
	    var zoomValueStep = null;
        var zoomSet = new Windows.Media.Devices.ZoomSettings();
	    if (isInitialized) {
	        if (isPreviewing) {
	            zoomValueNow = videoDev.zoom.tryGetValue();
	            zoomValueStep = videoDev.zoom.capabilities.step;
	            zoomValueMin = videoDev.zoom.capabilities.min ;
	            zoomValueMax = videoDev.zoom.capabilities.max;
	            console.log(videoDev.zoomControl.supported);

	            zoomSet.Mode = Windows.Media.Devices.ZoomTransitionMode.Auto;
	            zoomSet.Value = zoomValueNow + zoomValueStep;
	            //videoDev.zoomControl.configure(zoomSet);
	        }
	    }
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
	            // The call to stop the preview is included here for completeness, but can be
	            // safely removed if a call to MediaCapture.close() is being made later,
	            // as the preview will be automatically stopped at that point
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
    /// Gets the current preview frame as a SoftwareBitmap, displays its properties in a TextBlock, and can optionally display the image
    /// in the UI and/or save it to disk as a jpg
    /// </summary>
    /// <returns></returns>
	function getPreviewFrameAsSoftwareBitmapAsync() {
	    // Get information about the preview
	    var previewProperties = oMediaCapture.videoDeviceController.getMediaStreamProperties(Capture.MediaStreamType.videoPreview);
	    var videoFrameWidth = previewProperties.width;
	    var videoFrameHeight = previewProperties.height;

	    // Create the video frame to request a SoftwareBitmap preview frame
	    var videoFrame = new Windows.Media.VideoFrame(Imaging.BitmapPixelFormat.bgra8, videoFrameWidth, videoFrameHeight);

	    // Capture the preview frame
	    return oMediaCapture.getPreviewFrameAsync(videoFrame)
        .then(function (currentFrame) {
            // Collect the resulting frame
            var frameBitmap = currentFrame.softwareBitmap;

            // Show the frame information
            //frameInfoTextBlock.textContent = frameBitmap.pixelWidth + "x" + frameBitmap.pixelHeight + " " +
                //stringOfEnumeration(Windows.Graphics.DirectX.DirectXPixelFormat, frameBitmap.bitmapPixelFormat);

            // Save and show the frame (as is, no rotation is being applied)
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
    /// Gets the current preview frame as a Direct3DSurface and displays its properties in a TextBlock
    /// </summary>
    /// <returns></returns>
	function getPreviewFrameAsD3DSurfaceAsync() {
	    // Capture the preview frame as a D3D surface
	    return oMediaCapture.getPreviewFrameAsync()
        .then(function (currentFrame) {
            // Check that the Direct3DSurface isn't null. It's possible that the device does not support getting the frame
            // as a D3D surface
            if (currentFrame.direct3DSurface != null) {
                // Collect the resulting frame
                var surface = currentFrame.direct3DSurface;

                // Show the frame information
                frameInfoTextBlock.textContent = surface.description.width + "x" + surface.description.height + " " +
                    stringOfEnumeration(Windows.Graphics.DirectX.DirectXPixelFormat, surface.description.format);
            }
            else { // Fall back to software bitmap
                // Collect the resulting frame
                var frameBitmap = currentFrame.softwareBitmap;

                // Show the frame information
                frameInfoTextBlock.textContent = frameBitmap.pixelWidth + "x" + frameBitmap.pixelHeight + " " +
                    stringOfEnumeration(Windows.Graphics.DirectX.DirectXPixelFormat, frameBitmap.bitmapPixelFormat);
            }

            // Clear the image
            previewFrameImage.src = null;
        }, function (error) {
            console.log(error.message)
        });
	}

    /// <summary>
    /// Saves a SoftwareBitmap to the Pictures library with the specified name
    /// </summary>
    /// <param name="bitmap"></param>
    /// <returns></returns>
	function saveAndShowSoftwareBitmapAsync(bitmap) {
	    var oFile = null;
	    return Windows.Storage.KnownFolders.picturesLibrary.createFileAsync("PreviewFrame.jpg", Windows.Storage.CreationCollisionOption.generateUniqueName)
        .then(function (file) {
            oFile = file;
            return file.openAsync(Windows.Storage.FileAccessMode.readWrite);
        }).then(function (outputStream) {
            return Imaging.BitmapEncoder.createAsync(Imaging.BitmapEncoder.jpegEncoderId, outputStream);
        }).then(function (encoder) {
            // Grab the data from the SoftwareBitmap
            encoder.setSoftwareBitmap(bitmap);
            return encoder.flushAsync();
        }).done(function () {
            // Finally display the image at the correct orientation
            previewFrameImage.src = oFile.path;
            previewFrameImage.style.transform = "rotate(" + convertDisplayOrientationToDegrees(oDisplayOrientation) + "deg)";
        });
	}


    /// <summary>
    /// Attempts to find and return a device mounted on the panel specified, and on failure to find one it will return the first device listed
    /// </summary>
    /// <param name="panel">The desired panel on which the returned device should be mounted, if available</param>
    /// <returns></returns>
	function findCameraDeviceByPanelAsync(panel) {
	    var deviceInfo = null;
	    // Get available devices for capturing pictures
	    return DeviceInformation.findAllAsync(DeviceClass.videoCapture)
        .then(function (devices) {
            devices.forEach(function (cameraDeviceInfo) {
                if (cameraDeviceInfo.enclosureLocation != null && cameraDeviceInfo.enclosureLocation.panel === panel) {
                    deviceInfo = cameraDeviceInfo;
                    return;
                }
            });

            // Nothing matched, just return the first
            if (!deviceInfo && devices.length > 0) {
                deviceInfo = devices.getAt(0);
            }

            return deviceInfo;
        });
	}

    /// <summary>
    /// Converts the given orientation of the app on the screen to the corresponding rotation in degrees
    /// </summary>
    /// <param name="orientation">The orientation of the app on the screen</param>
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
    /// This event will fire when the page is rotated, when the DisplayInformation.AutoRotationPreferences value set in the setupUiAsync() method cannot be not honored.
    /// </summary>
    /// <param name="sender">The event source.</param>
	function displayInformation_orientationChanged(args) {
	    oDisplayOrientation = args.target.currentOrientation;

	    if (isPreviewing) {
	        setPreviewRotationAsync();
	    }
	}

	function getPreviewFrameButton_tapped() {
	    // If preview is not running, no preview frames can be acquired
	    if (!isPreviewing) {
	        return;
	    }
	    getPreviewFrameAsSoftwareBitmapAsync().done();
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
            // Calculate rotation angle, taking mirroring into account if necessary
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
    /// In the event of the app being minimized this method handles media property change events. If the app receives a mute
    /// notification, it is no longer in the foregroud.
    /// </summary>
    /// <param name="args"></param>
	function systemMediaControls_PropertyChanged(args) {
	    // Check to see if the app is being muted. If so, it is being minimized.
	    // Otherwise if it is not initialized, it is being brought into focus.
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
    /// Converts an enum to a readable string
    /// </summary>
    /// <param name="enumeration">The actual enumeration</param>
    /// <param name="enumeration">The value of the given enumeration</param>
    /// <returns>String of the enumeration value</returns>
	function stringOfEnumeration(enumeration, value) {
	    for (var k in enumeration) if (enumeration[k] == value) {
	        return k;
	    }

	    return null;
	}

	app.start();
})();
