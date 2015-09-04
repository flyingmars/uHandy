function MyCamera() {
    console.log("Camera Obj Construct");
    this.Capture = Windows.Media.Capture;
    this.DeviceInformation = Windows.Devices.Enumeration.DeviceInformation;
    this.DeviceClass = Windows.Devices.Enumeration.DeviceClass;
    this.DisplayOrientations = Windows.Graphics.Display.DisplayOrientations;
    this.Imaging = Windows.Graphics.Imaging;
    this.Media = Windows.Media;

    // 收到關於介面或裝置的旋轉通知，並作對應的動作。
    this.oDisplayInformation = Windows.Graphics.Display.DisplayInformation.getForCurrentView();
    this.oDisplayOrientation = this.DisplayOrientations.portrait;

    // 當照相機工作時，防止休眠
    this.oDisplayRequest = new Windows.System.Display.DisplayRequest();

    // 監聽媒體性質的改變
    this.oSystemMediaControls = this.Media.SystemMediaTransportControls.getForCurrentView();

    // 媒體裝置與狀態參數
    this.oMediaCapture = null;
    this.isInitialized = false;
    this.isPreviewing = false;

    // 相機裝置的資訊
    this.externalCamera = false;
    this.mirroringPreview = false;

    // 旋轉的原始資料，以便應用於串流(MF_MT_VIDEO_ROTATION)
    // 參考連結: http://msdn.microsoft.com/en-us/library/windows/apps/xaml/hh868174.aspx
    this.RotationKey = "C380465D-2271-428C-9B83-ECEA3B4A85C1";
}

MyCamera.prototype.initState = function () {
    //previewFrameImage.src = null;
}

MyCamera.prototype.activeCamera = function () {
    //this.oDisplayInformation.addEventListener("orientationchanged", displayInformation_orientationChanged);
    this.initializeCameraAsync();
}

MyCamera.prototype.initializeCameraAsync = function() {
    console.log("InitializeCameraAsync");

    // 取得可用的照相裝置
    return this.findCameraDeviceByPanelAsync(Windows.Devices.Enumeration.Panel.back)
    .then(function (camera) {
        if (!camera) {
            console.log("No camera device found!");
            return;
        }
        // 找出相機的位置
        if (!camera.enclosureLocation || camera.enclosureLocation.panel === Windows.Devices.Enumeration.Panel.unknown) {
            // 進到這裡，表示找不到對應的相機位置，假設是外部相機
            this.externalCamera = true;
        } else {
            // 進到這裡，表示是裝置上的常駐相機
            this.externalCamera = false;

            // 前鏡頭的話，將其鏡相呈現
            this.mirroringPreview = (camera.enclosureLocation.panel === Windows.Devices.Enumeration.Panel.front);
        }

        this.oMediaCapture = new Capture.MediaCapture();

        // 監聽「當無法捕捉畫面時」的事件
        this.oMediaCapture.addEventListener("failed", mediaCapture_failed);

        var settings = new Capture.MediaCaptureInitializationSettings();
        settings.videoDeviceId = camera.id;

        // 初始化並開始顯示畫面
        return oMediaCapture.initializeAsync(settings);
    }).then(function () {
        this.isInitialized = true;
        return function () {
            // 防止進入休眠
            this.oDisplayRequest.requestActive();

            // 註冊監聽媒體特性改變
            this.oSystemMediaControls.addEventListener("propertychanged", systemMediaControls_PropertyChanged);

            // 設定Preveiw來源，如果有需要以鏡像呈現
            var previewVidTag = document.getElementById("cameraPreview");
            if (this.mirroringPreview) {
                this.cameraPreview.style.transform = "scale(-1, 1)";
            }
            try {
                var previewUrl = URL.createObjectURL(oMediaCapture);
                previewVidTag.src = previewUrl;
                previewVidTag.play();
                previewVidTag.addEventListener("playing", function () {
                    this.isPreviewing = true;
                    this.setPreviewRotationAsync();
                });
            } catch (e) {
                console.log(e.message);
            }
        }
    }, function (error) {
        console.log(error.message);
    }).done();


}

MyCamera.prototype.findCameraDeviceByPanelAsync = function(panel) {
    var deviceInfo = null;
    // 尋找可以用的照相裝置
    return this.DeviceInformation.findAllAsync(this.DeviceClass.videoCapture)
    .then(function (devices) {
        devices.forEach(function (cameraDeviceInfo) {
            if (cameraDeviceInfo.enclosureLocation != null && cameraDeviceInfo.enclosureLocation.panel === panel) {
                deviceInfo = cameraDeviceInfo;
                return;
            }
        });

        // 找不到，回傳第一個就好
        if (!deviceInfo && devices.length > 0) {
            deviceInfo = devices.getAt(0);
        }

        return deviceInfo;
    });
}
