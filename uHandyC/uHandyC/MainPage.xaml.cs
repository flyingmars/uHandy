using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices.WindowsRuntime;
using Windows.Foundation;
using Windows.Foundation.Collections;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Controls.Primitives;
using Windows.UI.Xaml.Data;
using Windows.UI.Xaml.Input;
using Windows.UI.Xaml.Media;
using Windows.UI.Xaml.Navigation;
using System.Threading.Tasks;         // Used to implement asynchronous methods
using Windows.Devices.Enumeration;    // Used to enumerate cameras on the device
using Windows.Devices.Sensors;        // Orientation sensor is used to rotate the camera preview
using Windows.Graphics.Display;       // Used to determine the display orientation
using Windows.Graphics.Imaging;       // Used for encoding captured images
using Windows.Media;                  // Provides SystemMediaTransportControls
using Windows.Media.Capture;          // MediaCapture APIs
using Windows.Media.MediaProperties;  // Used for photo and video encoding
using Windows.Storage;                // General file I/O
using Windows.Storage.FileProperties; // Used for image file encoding
using Windows.Storage.Streams;        // General file I/O
using Windows.System.Display;         // Used to keep the screen awake during preview and capture
using Windows.UI.Core;                // Used for updating UI from within async operations
using System.Diagnostics;

//空白頁項目範本收錄在 http://go.microsoft.com/fwlink/?LinkId=402352&clcid=0x409

namespace uHandyC {
    /// <summary>
    /// 可以在本身使用或巡覽至框架內的空白頁面。
    /// </summary>
    public sealed partial class MainPage : Page {
        private MediaCapture _mediaCapture;
        private bool _isInitialized;
        private bool _isPreviewing;
        private bool _isRecording;
        private bool _externalCamera;
        private bool _mirroringPreview;

        private readonly DisplayRequest _displayRequest = new DisplayRequest();

        private readonly DisplayInformation _displayInformation = DisplayInformation.GetForCurrentView();
        private DisplayOrientations _displayOrientation = DisplayOrientations.Portrait;
        private readonly SimpleOrientationSensor _orientationSensor = SimpleOrientationSensor.GetDefault();
        private SimpleOrientation _deviceOrientation = SimpleOrientation.NotRotated;
        private static readonly Guid RotationKey = new Guid("C380465D-2271-428C-9B83-ECEA3B4A85C1");

        private async Task StartPreviewAsync() {
            // Prevent the device from sleeping while the preview is running
            _displayRequest.RequestActive();

            // Set the preview source in the UI and mirror it if necessary
            PreviewControl.Source = _mediaCapture;
            PreviewControl.FlowDirection = _mirroringPreview ? FlowDirection.RightToLeft : FlowDirection.LeftToRight;

            // Start the preview
            try {
                await _mediaCapture.StartPreviewAsync();
                _isPreviewing = true;
            }
            catch (Exception ex) {
                Debug.WriteLine("Exception when starting the preview: {0}", ex.ToString());
            }

            // Initialize the preview to the current orientation
            if (_isPreviewing) {
                await SetPreviewRotationAsync();
            }
        }
        private async Task InitializeCameraAsync() {

            if (_mediaCapture == null) {

                // Get available devices for capturing pictures
                var allVideoDevices = await DeviceInformation.FindAllAsync(DeviceClass.VideoCapture);

                // Get the desired camera by panel
                DeviceInformation cameraDevice =
                    allVideoDevices.FirstOrDefault(x => x.EnclosureLocation != null &&
                    x.EnclosureLocation.Panel == Windows.Devices.Enumeration.Panel.Back);

                // If there is no camera on the specified panel, get any camera
                cameraDevice = cameraDevice ?? allVideoDevices.FirstOrDefault();

                if (cameraDevice == null) {
                    //ShowMessageToUser("No camera device found.");
                    return;
                }

                // Create MediaCapture and its settings
                _mediaCapture = new MediaCapture();

                // Register for a notification when video recording has reached the maximum time and when something goes wrong
                _mediaCapture.RecordLimitationExceeded += MediaCapture_RecordLimitationExceeded;

                var mediaInitSettings = new MediaCaptureInitializationSettings { VideoDeviceId = cameraDevice.Id };

                // Initialize MediaCapture
                try {
                    await _mediaCapture.InitializeAsync(mediaInitSettings);
                    _isInitialized = true;
                }
                catch (UnauthorizedAccessException) {
                    //ShowMessageToUser("The app was denied access to the camera");
                }
                catch (Exception ex) {
                    Debug.WriteLine("Exception when initializing MediaCapture with {0}: {1}", cameraDevice.Id, ex.ToString());
                }

                // If initialization succeeded, start the preview
                if (_isInitialized) {
                    // Figure out where the camera is located
                    if (cameraDevice.EnclosureLocation == null || cameraDevice.EnclosureLocation.Panel == Windows.Devices.Enumeration.Panel.Unknown) {
                        // No information on the location of the camera, assume it's an external camera, not integrated on the device
                        _externalCamera = true;
                    }
                    else {
                        // Camera is fixed on the device
                        _externalCamera = false;

                        // Only mirror the preview if the camera is on the front panel
                        _mirroringPreview = (cameraDevice.EnclosureLocation.Panel == Windows.Devices.Enumeration.Panel.Front);
                    }

                    await StartPreviewAsync();

                    UpdateCaptureControls();
                }
            }
        }
        private void RegisterOrientationEventHandlers() {
            // If there is an orientation sensor present on the device, register for notifications
            if (_orientationSensor != null) {
                _orientationSensor.OrientationChanged += OrientationSensor_OrientationChanged;
                _deviceOrientation = _orientationSensor.GetCurrentOrientation();
            }

            _displayInformation.OrientationChanged += DisplayInformation_OrientationChanged;
            _displayOrientation = _displayInformation.CurrentOrientation;
        }
        private void UnregisterOrientationEventHandlers() {
            if (_orientationSensor != null) {
                _orientationSensor.OrientationChanged -= OrientationSensor_OrientationChanged;
            }

            _displayInformation.OrientationChanged -= DisplayInformation_OrientationChanged;
        }
        private void OrientationSensor_OrientationChanged(SimpleOrientationSensor sender, SimpleOrientationSensorOrientationChangedEventArgs args) {
            if (args.Orientation != SimpleOrientation.Faceup && args.Orientation != SimpleOrientation.Facedown) {
                _deviceOrientation = args.Orientation;
            }
        }
        private async void DisplayInformation_OrientationChanged(DisplayInformation sender, object args) {
            _displayOrientation = sender.CurrentOrientation;

            if (_isPreviewing) {
                await SetPreviewRotationAsync();
            }

        }
        private static int ConvertDisplayOrientationToDegrees(DisplayOrientations orientation) {
            switch (orientation) {
                case DisplayOrientations.Portrait:
                    return 90;
                case DisplayOrientations.LandscapeFlipped:
                    return 180;
                case DisplayOrientations.PortraitFlipped:
                    return 270;
                case DisplayOrientations.Landscape:
                default:
                    return 0;
            }
        }
        private async Task SetPreviewRotationAsync() {
            // Only need to update the orientation if the camera is mounted on the device
            if (_externalCamera) return;

            // Populate orientation variables with the current state
            _displayOrientation = _displayInformation.CurrentOrientation;

            // Calculate which way and how far to rotate the preview
            int rotationDegrees = ConvertDisplayOrientationToDegrees(_displayOrientation);

            // The rotation direction needs to be inverted if the preview is being mirrored
            if (_mirroringPreview) {
                rotationDegrees = (360 - rotationDegrees) % 360;
            }

            // Add rotation metadata to the preview stream to make sure the aspect ratio / dimensions match when rendering and getting preview frames
            var props = _mediaCapture.VideoDeviceController.GetMediaStreamProperties(MediaStreamType.VideoPreview);
            props.Properties.Add(RotationKey, rotationDegrees);
            await _mediaCapture.SetEncodingPropertiesAsync(MediaStreamType.VideoPreview, props, null);

        }
        private async Task TakePhotoAsync() {
            var stream = new InMemoryRandomAccessStream();

            try {
                Debug.WriteLine("Taking photo...");
                await _mediaCapture.CapturePhotoToStreamAsync(ImageEncodingProperties.CreateJpeg(), stream);
                Debug.WriteLine("Photo taken!");

                var photoOrientation = ConvertOrientationToPhotoOrientation(GetCameraOrientation());
                await ReencodeAndSavePhotoAsync(stream, "photo.jpg", photoOrientation);
            }
            catch (Exception ex) {
                Debug.WriteLine("Exception when taking a photo: {0}", ex.ToString());
            }

        }
        private SimpleOrientation GetCameraOrientation() {
            if (_externalCamera) {
                // Cameras that are not attached to the device do not rotate along with it, so apply no rotation
                return SimpleOrientation.NotRotated;
            }

            // If the preview is being mirrored for a front-facing camera, then the rotation should be inverted
            if (_mirroringPreview) {
                // This only affects the 90 and 270 degree cases, because rotating 0 and 180 degrees is the same clockwise and counter-clockwise
                switch (_deviceOrientation) {
                    case SimpleOrientation.Rotated90DegreesCounterclockwise:
                        return SimpleOrientation.Rotated270DegreesCounterclockwise;
                    case SimpleOrientation.Rotated270DegreesCounterclockwise:
                        return SimpleOrientation.Rotated90DegreesCounterclockwise;
                }
            }

            return _deviceOrientation;
        }
        private static PhotoOrientation ConvertOrientationToPhotoOrientation(SimpleOrientation orientation) {
            switch (orientation) {
                case SimpleOrientation.Rotated90DegreesCounterclockwise:
                    return PhotoOrientation.Rotate90;
                case SimpleOrientation.Rotated180DegreesCounterclockwise:
                    return PhotoOrientation.Rotate180;
                case SimpleOrientation.Rotated270DegreesCounterclockwise:
                    return PhotoOrientation.Rotate270;
                case SimpleOrientation.NotRotated:
                default:
                    return PhotoOrientation.Normal;
            }
        }
        private static async Task ReencodeAndSavePhotoAsync(IRandomAccessStream stream, string filename, PhotoOrientation photoOrientation) {
            using (var inputStream = stream) {
                var decoder = await BitmapDecoder.CreateAsync(inputStream);

                var file = await KnownFolders.PicturesLibrary.CreateFileAsync(filename, CreationCollisionOption.GenerateUniqueName);

                using (var outputStream = await file.OpenAsync(FileAccessMode.ReadWrite)) {
                    var encoder = await BitmapEncoder.CreateForTranscodingAsync(outputStream, decoder);

                    var properties = new BitmapPropertySet { { "System.Photo.Orientation", new BitmapTypedValue(photoOrientation, PropertyType.UInt16) } };

                    await encoder.BitmapProperties.SetPropertiesAsync(properties);
                    await encoder.FlushAsync();
                }
            }
        }
        private void UpdateCaptureControls() {
            // The buttons should only be enabled if the preview started sucessfully
            PhotoButton.IsEnabled = _isPreviewing;
            VideoButton.IsEnabled = _isPreviewing;

            // Update recording button to show "Stop" icon instead of red "Record" icon
            StartRecordingIcon.Visibility = _isRecording ? Visibility.Collapsed : Visibility.Visible;
            StopRecordingIcon.Visibility = _isRecording ? Visibility.Visible : Visibility.Collapsed;

            // If the camera doesn't support simultaneosly taking pictures and recording video, disable the photo button on record
            if (_isInitialized && !_mediaCapture.MediaCaptureSettings.ConcurrentRecordAndPhotoSupported) {
                PhotoButton.IsEnabled = !_isRecording;

                // Make the button invisible if it's disabled, so it's obvious it cannot be interacted with
                PhotoButton.Opacity = PhotoButton.IsEnabled ? 1 : 0;
            }
        }
        private async void MediaCapture_RecordLimitationExceeded(MediaCapture sender) {
            await StopRecordingAsync();
        }
        private async Task StopRecordingAsync() {
            try {
                Debug.WriteLine("Stopping recording...");

                _isRecording = false;
                await _mediaCapture.StopRecordAsync();

                Debug.WriteLine("Stopped recording!");
            }
            catch (Exception ex) {
                Debug.WriteLine("Exception when stopping video recording: {0}", ex.ToString());
            }
        }
        public MainPage() {
            this.InitializeComponent();
        }

        private void button_Click(object sender, RoutedEventArgs e) {

        }
    }
}
