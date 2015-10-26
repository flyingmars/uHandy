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
	var previewUrl = null;
    // Windows App 必要參數
	var app = WinJS.Application;
	var activation = Windows.ApplicationModel.Activation;

    // 觸控事件參數
	var oGestureHandler;
	var current_img_name;

	app.onactivated = function (args) {
		if (args.detail.kind === activation.ActivationKind.launch) {
			if (args.detail.previousExecutionState !== activation.ApplicationExecutionState.terminated) {
			    // 此應用程式已全新啟動。請在這裡初始化應用程式。
                // 按鈕註冊
			    $("#getPreviewFrameButton")
                    .mousedown(getPreviewFrameButton_clicked)
                    .mouseup(getPreviewFrameButton_tapped);
			    $("#toggleRuler")
                    .mousedown(getToggleRulerButton_clicked)
                    .mouseup(getToggleRulerButton_tapped);
			    $("#canvasStart")
                    .mousedown(getStartCanvas_clicked)
                    .mouseup(getStartCanvas_tapped);
			    $("#getShare")
                    .mousedown(getShare_clicked)
                    .mouseup(getShare_tapped);
			    $('#cameraPreview').resize(resizeHandler);
			    $('#pictureLibrary')
                    .mousedown(getPictureLibrary_clicked)
                    .mouseup(getPictureLibrary_tapped);

                // Preview 位址
			    previewFrameImage.src = null;
			}

		    // 視窗事件註冊
			oDisplayInformation.addEventListener("orientationchanged", displayInformation_orientationChanged);
			initializeCameraAsync();

		    // 觸控
			document.getElementById('cameraDiv').addEventListener('click',getTouchClick,false);
			initGestureHandler();

            // 尺標
			$('#rulerInfo').draggable()  ;
			resizeHandler();

		    // 分享
			

            // Promise Process
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

    // Handler 函數
	function resizeHandler() {
	    // 尺規校正
	    var zoomScale = oMediaCapture ? 500*Math.exp(-0.007* oMediaCapture.videoDeviceController.zoom.tryGetValue().value ): 500 ;
	    var scaleCorrect = $('#cameraPreview').css('transform').split(',')[3] || 1;
	    var originRatio = 100;
	    var displayWidth = document.getElementById('cameraPreview').clientWidth;
	    var rulerWidth = document.getElementById('rulerInfo').clientWidth;
	    var displayValue = Math.round( (zoomScale / scaleCorrect ) / 10) * 10;
	    $('#rulerInfo > .rulerNum').html(displayValue + ' ㎛');
	    //console.log('resize = ' + zoomScale);
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
            try{
                var videoDev  = oMediaCapture.videoDeviceController;
                var valueNow  = videoDev.zoom.tryGetValue().value;
                var valueStep = videoDev.zoom.capabilities.step;
                var valueMin  = videoDev.zoom.capabilities.min;
                var valueMax = Math.min(300, videoDev.zoom.capabilities.max);

                //            console.log('evt=' + evt.scale + ' want to ' + (valueNow + valueStep));
                if (evt.scale > 1.0 && (valueNow + valueStep*2) <= valueMax) {
                    videoDev.zoom.trySetValue(valueNow + valueStep *2);
                    console.log('set state = ' + ( valueNow + valueStep*2 ));
                } else if (evt.scale < 1.0 && (valueNow - valueStep*2) >= valueMin) {
                    videoDev.zoom.trySetValue(valueNow - valueStep*2);
                    console.log('set state = ' + (valueNow - valueStep));
                }
            } catch (e) {
                // Handle no camera here
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
	        initInkCanvas();
	        $("#canvasStart").data('myvalue', 1);
	        $("#inkdraw").show();
	        $('.senerio-inkMode').show();
	    } else {
	        $("#canvasStart > i").css('color', 'white');
	        $("#inkdraw").hide();
	        $("#canvasStart").data('myvalue', 0);
	        $('.senerio-inkMode').hide();
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
	    var videoDev = oMediaCapture.videoDeviceController ;
	    var focusValueMax = null;
	    var focusValueMin = null;
	    var focusValueNow = null;
	    var focusValueStep = null;

	    if (isInitialized) {
	        if (isPreviewing) {
	            focusValueNow = videoDev.focus.tryGetValue().value;
	            focusValueStep = videoDev.focus.capabilities.step;
	            focusValueMin = videoDev.focus.capabilities.min ;
	            focusValueMax = videoDev.focus.capabilities.max;
	            //console.log( 'set = ' + videoDev.contrast.trySetAuto(true) );
	            //zoomSet.Mode = Windows.Media.Devices.ZoomTransitionMode.Auto;
	            //zoomSet.Value = zoomValueNow + zoomValueStep;
	            //videoDev.zoomControl.configure(zoomSet);
                
	            console.log('set state = ' + videoDev.focus.trySetValue(focusValueNow + focusValueStep));
	        }
	    }
	}

	function getPreviewFrameButton_clicked(){
	    $('#getPreviewFrameButton > i').css('color','gray');
	}
	function getPreviewFrameButton_tapped(flag) {

	    if (flag == 1) {
	        // 從相簿傳過來的
	    } else {
            // 真的是按了照相按鈕
	        if (!isPreviewing) {
	            // 如果沒有在 preview 中，則無法取得畫面
	            return;
	        }
	        $('#getPreviewFrameButton > i').css('color', 'white');
	        getPreviewFrameAsSoftwareBitmapAsync().then(function (name) {
	            passPhotoToShow(name);
	        }).done();
	    }
	    // 取得照片Preview及顯示/隱藏 必要的按鍵
	    $('.senerio-preview').hide();
	    $('.senerio-pictureLibrary').hide();
	    $('.senerio-inkMode').hide();
	    $('.senerio-handlePicture').show();

	    $("#canvasStart > i").css('color', 'white');
	    $("#canvasStart").data('myvalue', 0);
	    $('#inkdraw').hide();

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
        .then(function(){
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
            // 開始看圖片
	        $('.senerio-handlePicture').hide();
	        $('.senerio-preview').hide();
	        $('.senerio-inkMode').hide();
	        $('.senerio-pictureLibrary').show();
	        $("#pictureLibrary").data('myvalue', 1);
	        renderPhoto();
	    } else {
	        destroyPhoto();
	        $('.senerio-handlePicture').hide();
	        $('.senerio-pictureLibrary').hide();
	        $('.senerio-inkMode').hide();
	        $('.senerio-preview').show();
	        $("#pictureLibrary").data('myvalue', 0);
	    }
	}
	function renderPhoto() {
	    var localFolder = Windows.Storage.ApplicationData.current.localFolder;
	    //var query = localFolder.createFolderQuery(Windows.Storage.Search.CommonFolderQuery.groupByTag);
	    localFolder.getItemsAsync().then(function (items) {
	        items.forEach(function (item) {
	            var classCount = 0;
	            if (item.name.match(/uHandy_R(\d+).*\.jpg$/)) {
	                var size = RegExp.$1;
	                var requestedSize = 200;
	                var thumbnailMode = Windows.Storage.FileProperties.ThumbnailMode.picturesView;
	                var thumbnailOptions = Windows.Storage.FileProperties.ThumbnailOptions.useCurrentScale;
	                item.getThumbnailAsync(thumbnailMode, requestedSize, thumbnailOptions).done(function (thumbnail) {
	                    if (thumbnail) {
	                        if ($('#pictureShow > .container-' + size / 50 + ' > h1' ).length  == 0) {
	                            $('#pictureShow > .container-' + size / 50 + '').append(
                                    '<h1>' + size + '-' + (parseInt(size) + 50) + ' ㎛' + '</h1>'
                                )
	                        }
	                        $('#pictureShow > .container-' + size / 50).append(
                                '<img class="tempcount-' + classCount + '"  src="' + URL.createObjectURL(thumbnail, { oneTimeOnly: true }) + '" data-name="' + item.name + '" />'
                            );
	                        $('#pictureShow > .container-' + size / 50 + ' > img.tempcount-' + classCount).click(passPhotoToShow);

	                        classCount++;

	                        // 這邊要記得對每個圖片Bind 選取的Listener，指向編輯照片的頁面
	                    } else {
	                        WinJS.log && WinJS.log(SdkSample.errors.noThumbnail, "sample", "status");
	                    }
	                });
	            }
	        });
	    }).done();
	}
	function destroyPhoto() {
	    $('#pictureShow > div').html('');
	}
	function passPhotoToShow() {
	    current_img_name = $(this).data('name');

	    var localFolder = Windows.Storage.ApplicationData.current.localFolder;
	    localFolder.getItemAsync($(this).data('name')).then(
            function(item){
                previewFrameImage.src = URL.createObjectURL(item);
            },
            function(error){
                console.log('error on loading file');
            }
	    ).done(function () {
	        getPreviewFrameButton_tapped(1);
	    });

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


	    // 處理讀檔的過程
	    var localFolder = Windows.Storage.ApplicationData.current.localFolder;
	    var loadStream = null;
	    localFolder.tryGetItemAsync(current_img_name + '_ink.gif').then(function (item) {
	        if (item) {
	            item.openAsync(Windows.Storage.FileAccessMode.read).then(function (stream) {
	                loadStream = stream;
	                try {
	                    return inkManager.loadAsync(loadStream); // since we return the promise, it will be executed before the following .done
	                } catch (e) {
	                    console.log(e.message);
	                };
	            }).done(
                    function () {
                        // done loading, print status message
                        var strokes = inkManager.getStrokes().length;
                        // update the canvas, render all strokes
                        renderAllStrokes();
                        loadStream.close();
                    }, function (e) {
                        if (loadStream) {
                            loadStream.close();
                        }
                    }
                );
	        }
	    });


	    // 處理存檔的過程
	    var saveStream = null;
	    var deleteInk_clicked = function () {
	        $("#deleteInk > i").css('color', 'gray');
	    };
	    var deleteInk_tapped = function () {
	        $("#deleteInk > i").css('color', 'white');
	        clearall();
	    };
	    var getSave_clicked = function () {
	        $("#getSave > i").css('color', 'gray');
	    };
	    var getSave_tapped = function () {
	        $("#getSave > i").css('color', 'white');
	        localFolder.tryGetItemAsync(current_img_name + '_ink.gif')
                .then(function (item) {
                    if (inkManager.getStrokes().length > 0) {
                        if (item) {
                            return item.openAsync(Windows.Storage.FileAccessMode.readWrite);
                        } else {
                            return localFolder.createFileAsync(current_img_name + '_ink.gif', Windows.Storage.CreationCollisionOption.replaceExisting)
                                .then(function (file) {
                                    return file.openAsync(Windows.Storage.FileAccessMode.readWrite);
                                });
                        }
                    } else {
                        return localFolder.createFileAsync(current_img_name + '_ink.gif', Windows.Storage.CreationCollisionOption.replaceExisting)
                            .then(function (file) {
                                return file.openAsync(Windows.Storage.FileAccessMode.readWrite);
                            });
                    }
                }).then(function (stream) {
                    saveStream = stream;
                }).then(function () {
                    try {
                        if (inkManager.getStrokes().length > 0) {
                            return inkManager.saveAsync(saveStream);
                        }
                    } catch (e) {
                        console.log(e.message);
                    }
                }).done(
                    function () {
                        saveStream.close();
                    },
                    function (e) {
                        if (saveStream) {
                            saveStream.close();
                        }
                    }
                );
	    };
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
	        var current = evt.currentPoint;

	        // Get the device type for the pointer input.
	        pointerDeviceType = getPointerDeviceType(evt.pointerId);


	        // Process one pointer at a time.
	        if (pointerId === -1) {
	            // Process pen and mouse (with left button) only. Reserve touch for manipulations.
	            if ((pointerDeviceType === "Pen" && (!current.properties.isEraser)) || (pointerDeviceType === "Touch") || ((pointerDeviceType === "Mouse") && (evt.button === 0))) {

	                // Start drawing the stroke.
	                inkContext.beginPath();
	                inkContext.lineWidth = '1';
	                inkContext.strokeStyle = 'red';
	                inkContext.lineCap = "round";
	                inkContext.lineJoin = "round";
	                inkContext.moveTo(current.rawPosition.x, current.rawPosition.y);
	                inkManager.mode = Windows.UI.Input.Inking.InkManipulationMode.inking;

	            } else if ((evt.pointerType === "pen") && (current.properties.isEraser)) {
	                inkContext.strokeStyle = "rgba(255,255,255,0.0)";
	                inkManager.mode = Windows.UI.Input.Inking.InkManipulationMode.erasing;
	            }

	            // Add current pointer to the ink manager (begin stroke).
	            inkManager.processPointerDown(current);

	            // The pointer id is used to restrict input processing to the current stroke.
	            pointerId = evt.pointerId;
	        }
	    };

	    var onPointerMove = function (evt) {
	        if (evt.pointerId === pointerId) {
	            var current = evt.currentPoint;
	            var update = inkManager.processPointerUpdate(current);

	            if (inkManager.mode === Windows.UI.Input.Inking.InkManipulationMode.erasing) {
	                // if the dirty rect is not empty then some strokes have been erased and we need to update the render.
	                if (update.height > 0 || update.width > 0) {
	                    console.log(update.height + ' ' + update.width);
	                    renderAllStrokes();
	                }
	            } else {
	                // live rendering is done here
	                inkContext.lineTo(current.rawPosition.x, current.rawPosition.y);
	                inkContext.stroke();
	            }
	        }
	    };

	    var onPointerUp = function (evt) {
	        if (evt.pointerId === pointerId) {
	            // Process pen and mouse (with left button) only. Reserve touch for manipulations.
	            if ((pointerDeviceType === "Pen") || (pointerDeviceType === "Touch") || ((pointerDeviceType === "Mouse") && (evt.button === 0))) {
	                //console.log(pointerDeviceType + " pointer up: Finish stroke. ");

	                // Add current pointer to the ink manager (end stroke).
	                inkManager.processPointerUp(evt.currentPoint);

	                // End live drawing.
	                inkContext.closePath();

	                // Render strokes using bezier curves.
	                renderAllStrokes();

	              
	            }
	            else {
	                // Process touch input.
	            }

	            // Reset pointer Id.
	            pointerId = -1;

	        }
	    };

	    var renderAllStrokes = function () {
	        inkContext.clearRect(0, 0, inkCanvas.width, inkCanvas.height); 
	        // Iterate through each stroke.
	        inkManager.getStrokes().forEach(
                function (stroke) {
                    inkContext.beginPath();
                    if (stroke.selected) {
                        inkContext.lineWidth = stroke.drawingAttributes.size.width * 2;
                        inkContext.strokeStyle = "green";
                    } else {
                        inkContext.lineWidth = stroke.drawingAttributes.size.width;
                        inkContext.strokeStyle = "red";
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
        
	    var clearall = function () {
	        inkManager.getStrokes().forEach(function (stroke) {
	            stroke.selected = true;
	        });
            inkManager.deleteSelected();
            renderAllStrokes();

	    };

	    // Set up the handlers for input processing.
	    inkCanvas.addEventListener("pointerdown", onPointerDown);
	    inkCanvas.addEventListener("pointermove", onPointerMove);
	    inkCanvas.addEventListener("pointerup", onPointerUp);
	    $('#getSave').mousedown(getSave_clicked);
	    $('#getSave').mouseup(getSave_tapped);
	    $('#deleteInk').mousedown(deleteInk_clicked);
	    $('#deleteInk').mouseup(deleteInk_tapped);

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
            // set origin zoom to min zoom scale
            try{
                oMediaCapture.videoDeviceController.zoom.trySetValue(1);
            }catch(e){
                // Handle no camera here
            }
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
	        previewUrl = URL.createObjectURL(oMediaCapture)
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
	    var zoomScale = oMediaCapture ? 500*Math.exp(-0.007* oMediaCapture.videoDeviceController.zoom.tryGetValue().value ): 500 ;
	    var scaleCorrect = $('#cameraPreview').css('transform').split(',')[3] || 1;
	    var displayValue = Math.round( (zoomScale / scaleCorrect ) / 50) * 50;
	    var oFile = null;

	    //return Windows.Storage.KnownFolders.picturesLibrary.createFileAsync("uHandy.jpg", Windows.Storage.CreationCollisionOption.generateUniqueName)
	    return Windows.Storage.ApplicationData.current.localFolder.createFileAsync(
            "uHandy_R" + displayValue + "_D" + ".jpg" ,
            Windows.Storage.CreationCollisionOption.generateUniqueName
        )
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
            console.log(oFile.path);
            //previewFrameImage.src = oFile.path;
            //previewFrameImage.style.transform = "rotate(" + convertDisplayOrientationToDegrees(oDisplayOrientation) + "deg)";
            return oFile.name;
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
