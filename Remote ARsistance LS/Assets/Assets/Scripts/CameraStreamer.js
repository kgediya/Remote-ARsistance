function startStreaming(script, socket, cameraModule) {
    let request = CameraModule.createCameraRequest();
    request.cameraId = CameraModule.CameraId.Left_Color;
    let texture = cameraModule.requestCamera(request);

    texture.control.onNewFrame.add(async () => {
        script.preview.mainPass.baseTex = texture;
        try {
            let base64 = await encodeTextureToBase64(texture);
            socket.send(base64 + "|||FRAME_END|||");
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
