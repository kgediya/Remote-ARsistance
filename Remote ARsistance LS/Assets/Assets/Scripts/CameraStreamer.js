function startStreaming(script, socket, cameraModule) {
    let request = CameraModule.createCameraRequest();
    request.cameraId =global.deviceInfoSystem.isEditor()?CameraModule.CameraId.Default_Color:CameraModule.CameraId.Left_Color;
    let texture = cameraModule.requestCamera(request);

    texture.control.onNewFrame.add(async () => {
        script.preview.mainPass.baseTex = texture;
script.screenCropTex.control.inputTexture = texture;       
         try {
           
            let base64 = await encodeTextureToBase64(script.renderTarget);
            socket.send(base64 + "|||FRAME_END|||");
        } catch (e) {
            print("Encoding error: " + e);
        }
    });
}
function startRendering(script, socket) {
    let width = 512;
    let height = 512;
    let channels = 4;

    print("Creating safe CPU texture...");
    let safeTex = ProceduralTextureProvider.create(width, height, Colorspace.RGBA);

    print("Binding update event...");
    script.createEvent('UpdateEvent').bind(async () => {
        try {
            print("UpdateEvent triggered.");

            let frame = script.renderTarget;
            print("Got renderTarget:" + frame);

            if (!frame) {
                print("No frame to copy from.");
                return;
            }

            print("Creating CPU-safe texture from GPU frame...");
            let cpuFrame = ProceduralTextureProvider.createFromTexture(frame);

            print("cpuFrame:" + cpuFrame);

            if (!cpuFrame || !cpuFrame.control) {
                print("Failed to create CPU texture from GPU frame.");
                return;
            }

            print("Reading pixels from CPU texture...");
            let pixelData = new Uint8Array(width * height * channels);
            cpuFrame.control.getPixels(0, 0, width, height, pixelData);

            print("Pixels read successfully. Writing to safeTex...");
            safeTex.control.setPixels(0, 0, width, height, pixelData);

            print("Encoding to base64...");
            let base64 = await encodeTextureToBase64(safeTex);

            if (base64) {
                print("Base64 encoding successful. Sending over socket...");
                socket.send(base64 + "|||FRAME_END|||");
            } else {
                print("Base64 encoding failed.");
            }

        } catch (e) {
            print("Encoding error: " + e);
        }
    });
}

function encodeTextureToBase64(texture) {
    return new Promise((resolve, reject) => {
        Base64.encodeTextureAsync(
            texture,
            resolve,
            reject,
            CompressionQuality.IntermediateQuality,
            EncodingType.Jpg
        );
    });
}

exports.startStreaming = startStreaming;
exports.startRendering = startRendering;