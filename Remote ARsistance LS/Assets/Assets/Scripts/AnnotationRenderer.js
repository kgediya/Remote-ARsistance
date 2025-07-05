function renderTextAnnotation(script,data) {
    if (!data) return;

    let { label, x, y } = data;

    let sceneObject = global.scene.createSceneObject("RemoteText");
    let text = sceneObject.createComponent("Component.Text");
    text.text = label.toUpperCase();
    text.size = 120;
    text.textFill.color = new vec4(1, 1, 0, 1);

    let bg = text.backgroundSettings;
    bg.enabled = true;
    bg.fill.color = new vec4(0, 0, 0, 0.6);
    bg.margins.left = 1.0;
    bg.margins.right = 1.0;

    let hitResult = script.instantWorldHitTest.hitTest(new vec2(x, y), () => {});
    let pos = hitResult.hits[0].position;
    sceneObject.getTransform().setWorldPosition(pos);
    sceneObject.copyComponent(script.lookAt);
}

exports.renderTextAnnotation = renderTextAnnotation;
