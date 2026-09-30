// AnnotationRenderer.js - Renders spatial 3D text pins and annotations in AR
const ChatUI = require("./ChatUI");

function renderTextAnnotation(script, data) {
    if (!data || data.type !== "text" || typeof data.label !== "string" ||
        data.label.length > 80 || !isFinite(data.x) || !isFinite(data.y) ||
        data.x < 0 || data.x > 1 || data.y < 0 || data.y > 1) return;
    const label = data.label.trim();
    if (!label || !script.instantWorldHitTest) return;

    let hitResult = null;
    try {
        hitResult = script.instantWorldHitTest.hitTest(new vec2(data.x, data.y));
    } catch (e) {
        print("[ARsistance][annotation] hit test error: " + e);
        return;
    }

    if (!hitResult || !hitResult.hits || !hitResult.hits.length) {
        ChatUI.showAlert("⚠ No surface found for annotation", 3.0);
        return;
    }

    try {
        const sceneObject = global.scene.createSceneObject("RemoteText");
        const text = sceneObject.createComponent("Component.Text");
        text.text = label;
        text.size = 42;
        text.textFill.color = new vec4(1.0, 0.95, 0.4, 1.0);

        const bg = text.backgroundSettings;
        if (bg) {
            bg.enabled = true;
            bg.fill.color = new vec4(0.06, 0.09, 0.12, 0.85);
            bg.cornerRadius = 0.35;
            if (bg.margins) {
                bg.margins.left = 1.0;
                bg.margins.right = 1.0;
                bg.margins.top = 0.5;
                bg.margins.bottom = 0.5;
            }
        }

        const outline = text.outlineSettings;
        if (outline) {
            outline.enabled = true;
            outline.fill.color = new vec4(0.0, 0.0, 0.0, 0.85);
        }

        const pos = hitResult.hits[0].position;
        sceneObject.getTransform().setWorldPosition(pos);
        if (script.lookAt) {
            sceneObject.copyComponent(script.lookAt);
        }
        ChatUI.showAlert("📍 Spatial pin placed: \"" + label + "\"", 3.0);
    } catch (e) {
        print("[ARsistance][annotation] render exception: " + e);
    }
}

exports.renderTextAnnotation = renderTextAnnotation;
