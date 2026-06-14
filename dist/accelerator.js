const modifierAliases = new Map([
    ["ctrl", "ctrl"],
    ["control", "ctrl"],
    ["cmdorctrl", "ctrl"],
    ["commandorcontrol", "ctrl"],
    ["shift", "shift"],
    ["alt", "alt"],
    ["option", "alt"],
    ["super", "meta"],
    ["meta", "meta"],
    ["cmd", "meta"],
    ["command", "meta"]
]);
const keyAliases = new Map([
    ["space", "KEY_SPACE"],
    ["tab", "KEY_TAB"],
    ["home", "KEY_HOME"],
    ["end", "KEY_END"],
    ["pageup", "KEY_PAGEUP"],
    ["pagedown", "KEY_PAGEDOWN"],
    ["insert", "KEY_INSERT"],
    ["delete", "KEY_DELETE"],
    ["del", "KEY_DELETE"],
    ["escape", "KEY_ESC"],
    ["esc", "KEY_ESC"],
    ["enter", "KEY_ENTER"],
    ["return", "KEY_ENTER"],
    ["backspace", "KEY_BACKSPACE"],
    ["period", "KEY_DOT"],
    [".", "KEY_DOT"],
    ["up", "KEY_UP"],
    ["down", "KEY_DOWN"],
    ["left", "KEY_LEFT"],
    ["right", "KEY_RIGHT"],
    ["numadd", "KEY_KPPLUS"],
    ["numsub", "KEY_KPMINUS"],
    ["numsubtract", "KEY_KPMINUS"],
    ["nummult", "KEY_KPASTERISK"],
    ["nummultiply", "KEY_KPASTERISK"],
    ["numdiv", "KEY_KPSLASH"],
    ["numdivide", "KEY_KPSLASH"],
    ["numenter", "KEY_KPENTER"],
    ["numdecimal", "KEY_KPDOT"]
]);
for (let code = 65; code <= 90; code += 1) {
    const key = String.fromCharCode(code);
    keyAliases.set(key.toLowerCase(), `KEY_${key}`);
}
for (let index = 1; index <= 12; index += 1) {
    keyAliases.set(`f${index}`, `KEY_F${index}`);
}
for (let index = 0; index <= 9; index += 1) {
    keyAliases.set(`num${index}`, `KEY_KP${index}`);
    keyAliases.set(`numpad${index}`, `KEY_KP${index}`);
}
function isBasicAlphabetKey(keyCode) {
    return /^KEY_[A-Z]$/.test(keyCode);
}
export function parseAccelerator(accelerator) {
    const parts = accelerator
        .split("+")
        .map((part) => part.trim())
        .filter(Boolean);
    if (parts.length === 0) {
        throw new Error("accelerator must not be empty");
    }
    const modifiers = new Set();
    let keyCode;
    for (const part of parts) {
        const normalized = part.toLowerCase();
        const modifier = modifierAliases.get(normalized);
        if (modifier) {
            modifiers.add(modifier);
            continue;
        }
        const mappedKey = keyAliases.get(normalized);
        if (!mappedKey) {
            throw new Error(`unsupported accelerator key: ${part}`);
        }
        if (keyCode) {
            throw new Error(`accelerator has multiple non-modifier keys: ${accelerator}`);
        }
        keyCode = mappedKey;
    }
    if (!keyCode) {
        throw new Error(`accelerator is missing a non-modifier key: ${accelerator}`);
    }
    const sortedModifiers = [...modifiers].sort();
    if (isBasicAlphabetKey(keyCode) && sortedModifiers.length === 0) {
        throw new Error(`basic alphabet key accelerators must include a modifier: ${accelerator}`);
    }
    return {
        keyCode,
        modifiers: sortedModifiers
    };
}
