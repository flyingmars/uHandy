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

    // Receive notifications about rotation of the device and UI and apply any necessary rotation to the preview stream and UI controls
	var oDisplayInformation = Windows.Graphics.Display.DisplayInformation.getForCurrentView(),
        oDisplayOrientation = DisplayOrientations.portrait;

    // Prevent the screen from sleeping while the camera is running
	var oDisplayRequest = new Windows.System.Display.DisplayRequest();

    // For listening to media property changes
	var oSystemMediaControls = Media.SystemMediaTransportControls.getForCurrentView();

    // MediaCapture and its state variables
	var oMediaCapture = null,
        isInitialized = false,
        isPreviewing = false,
        isRecording = false ;


    // Information about the camera device
	var externalCamera = false,
        mirroringPreview = false;

    // Rotation metadata to apply to the preview stream and recorded videos (MF_MT_VIDEO_ROTATION)
    // Reference: http://msdn.microsoft.com/en-us/library/windows/apps/xaml/hh868174.aspx
	var RotationKey = "C380465D-2271-428C-9B83-ECEA3B4A85C1";

	var app = WinJS.Application;
	var activation = Windows.ApplicationModel.Activation;

	app.onactivated = function (args) {
		if (args.detail.kind === activation.ActivationKind.launch) {
			if (args.detail.previousExecutionState !== activation.ApplicationExecutionState.terminated) {
			    // 此應用程式已全新啟動。請在這裡初始化應用程式。
			    document.getElementById("getPreviewFrameButton").addEventListener("click", getPreviewFrameButton_tapped);
			    previewFrameImage.src = null;
			}
			oDisplayInformation.addEventListener("orientationchanged", displayInformation_orientationChanged);
			initializeCameraAsync();
			args.setPromise(WinJS.UI.processAll());
            
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

	function getZoomButtonClick() {
	    console.log("getZoomButtonClick");
	    var videoDev = oMediaCapture.videoDeviceController ;
	    var zoomValue = null ;
	    if (isInitialized) {
	        if (isPreviewing) {
	            console.log(videoDev.zoom.capabilities.min);
	            console.log(videoDev.zoom.capabilities.max);
	            
	        }
	    }
	}

    /// <summary>
    /// Initializes the MediaCapture, registers events, gets camera device information for mirroring and rotating, starts preview and unlocks the UI
    /// </summary>
    /// <returns></returns>
	function initializeCameraAsync() {
	    console.log("InitializeCameraAsync");

	    // Get available devices for capturing pictures
	    return findCameraDeviceByPanelAsync(Windows.Devices.Enumeration.Panel.back)
        .then(function (camera) {
            if (!camera) {
                console.log("No camera device found!");
                return;
            }
            // Figure out where the camera is located
            if (!camera.enclosureLocation || camera.enclosureLocation.panel === Windows.Devices.Enumeration.Panel.unknown) {
                // No information on the location of the camera, assume it's an external camera, not integrated on the device
                externalCamera = true;
            }
            else {
                // Camera is fixed on the device
                externalCamera = false;

                // Only mirror the preview if the camera is on the front panel
                mirroringPreview = (camera.enclosureLocation.panel === Windows.Devices.Enumeration.Panel.front);
            }

            oMediaCapture = new Capture.MediaCapture();

            // Register for a notification when something goes wrong
            oMediaCapture.addEventListener("failed", mediaCapture_failed);

            var settings = new Capture.MediaCaptureInitializationSettings();
            settings.videoDeviceId = camera.id;

            // Initialize media capture and start the preview
            return oMediaCapture.initializeAsync(settings);
        }).then(function () {
            isInitialized = true;
            return startPreviewAsync();
        }, function (error) {
            console.log(error.message);
        }).done();
	}

    /// <summary>
    /// Cleans up the camera resources (after stopping any video recording and/or preview if necessary) and unregisters from MediaCapture events
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

	    // When all our tasks complete, clean up MediaCapture
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
    /// Starts the preview and adjusts it for for rotation and mirroring after making a request to keep the screen on
    /// </summary>
	function startPreviewAsync() {
	    // Prevent the device from sleeping while the preview is running
	    oDisplayRequest.requestActive();

	    // Register to listen for media property changes
	    oSystemMediaControls.addEventListener("propertychanged", systemMediaControls_PropertyChanged);

	    // Set the preview source in the UI and mirror it if necessary
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
    /// Gets the current orientation of the UI in relation to the device (when AutoRotationPreferences cannot be honored) and applies a corrective rotation to the preview
    /// </summary>
    /// <returns></returns>
	function setPreviewRotationAsync() {
	    // Only need to update the orientation if the camera is mounted on the device
	    if (externalCamera) {
	        return WinJS.Promise.as();
	    }

	    // Calculate which way and how far to rotate the preview
	    var rotationDegrees = convertDisplayOrientationToDegrees(oDisplayOrientation);

	    // The rotation direction needs to be inverted if the preview is being mirrored
	    if (mirroringPreview) {
	        rotationDegrees = (360 - rotationDegrees) % 360;
	    }

	    // Add rotation metadata to the preview stream to make sure the aspect ratio / dimensions match when rendering and getting preview frames
	    var props = oMediaCapture.videoDeviceController.getMediaStreamProperties(Capture.MediaStreamType.videoPreview);
	    props.properties.insert(RotationKey, rotationDegrees);
	    return oMediaCapture.setEncodingPropertiesAsync(Capture.MediaStreamType.videoPreview, props, null);
	}

    /// <summary>
    /// Stops the preview and deactivates a display request, to allow the screen to go into power saving modes
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
