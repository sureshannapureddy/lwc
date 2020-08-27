/*
 * Copyright (c) 2018, salesforce.com, inc.
 * All rights reserved.
 * SPDX-License-Identifier: MIT
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/MIT
 */
import {
    ArrayFilter,
    ArrayFind,
    ArrayPush,
    ArraySlice,
    defineProperties,
    defineProperty,
    getOwnPropertyDescriptor,
    hasOwnProperty,
    isNull,
    isTrue,
    isUndefined,
} from '@lwc/shared';
import featureFlags from '@lwc/features';
import { attachShadow, getShadowRoot, isHostElement } from './shadow-root';
import {
    getNodeOwner,
    getAllMatches,
    getFilteredChildNodes,
    getFirstMatch,
    getAllSlottedMatches,
    getFirstSlottedMatch,
} from './traverse';
import {
    attachShadow as originalAttachShadow,
    childrenGetter,
    childElementCountGetter,
    firstElementChildGetter,
    getElementsByClassName as elementGetElementsByClassName,
    getElementsByTagName as elementGetElementsByTagName,
    getElementsByTagNameNS as elementGetElementsByTagNameNS,
    innerHTMLGetter,
    innerHTMLSetter,
    innerTextGetter,
    innerTextSetter,
    lastElementChildGetter,
    outerHTMLSetter,
    outerHTMLGetter,
    outerTextGetter,
    outerTextSetter,
    querySelectorAll as elementQuerySelectorAll,
    shadowRootGetter as originalShadowRootGetter,
} from '../env/element';
import { windowGetComputedStyle, windowGetSelection } from '../env/window';
import { createStaticNodeList } from '../shared/static-node-list';
import { createStaticHTMLCollection } from '../shared/static-html-collection';
import {
    getNodeKey,
    getInternalChildNodes,
    hasMountedChildren,
    getNodeNearestOwnerKey,
    textContentGetterPatched,
    childNodesGetterPatched,
} from './node';
import { getOuterHTML } from '../3rdparty/polymer/outer-html';
import { arrayFromCollection, getOwnerWindow, isGlobalPatchingSkipped } from '../shared/utils';
import { getNodeOwnerKey, isNodeShadowed } from '../faux-shadow/node';
import { assignedSlotGetterPatched } from './slot';
import { getNonPatchedFilteredArrayOfNodes } from './no-patch-utils';
import { ELEMENT_NODE, TEXT_NODE } from '../env/node';

enum ShadowDomSemantic {
    Disabled,
    Enabled,
}

/**
 * Start of innerText Utility functions.
 */
type InnerTextCollectionResult = string | number;

function getElementComputedStyle(element: Element): CSSStyleDeclaration {
    const win = getOwnerWindow(element);

    return windowGetComputedStyle.call(win, element);
}

function getWindowSelection(node: Node): Selection | null {
    const win = getOwnerWindow(node);

    return windowGetSelection.call(win);
}

function nodeIsBeingRendered(nodeComputedStyle: CSSStyleDeclaration): boolean {
    return nodeComputedStyle.visibility !== 'hidden' && nodeComputedStyle.display !== 'none';
}

type SelectionState = {
    element: Element;
    onselect: ((this: GlobalEventHandlers, ev: Event) => any) | null;
    onselectionchange: ((this: GlobalEventHandlers, ev: Event) => any) | null;
    onselectstart: ((this: GlobalEventHandlers, ev: Event) => any) | null;
    ranges: Range[];
};
function getSelectionState(element: Element): SelectionState | null {
    const win = getOwnerWindow(element);
    const selection = getWindowSelection(element);

    if (selection === null) {
        return null;
    }

    const ranges: Range[] = [];
    for (let i = 0; i < selection.rangeCount; i++) {
        ranges.push(selection.getRangeAt(i));
    }

    const state: SelectionState = {
        element,
        onselect: win.onselect,
        onselectstart: win.onselectstart,
        onselectionchange: win.onselectionchange,
        ranges,
    };
    win.onselect = null;
    win.onselectstart = null;
    win.onselectionchange = null;

    return state;
}

function restoreSelectionState(state: SelectionState | null) {
    if (state === null) {
        return;
    }

    const { element, onselect, onselectstart, onselectionchange, ranges } = state;

    const win = getOwnerWindow(element);
    const selection = getWindowSelection(element)!;

    selection.removeAllRanges();
    for (let i = 0; i < ranges.length; i++) {
        selection.addRange(ranges[i]);
    }

    win.onselect = onselect;
    win.onselectstart = onselectstart;
    win.onselectionchange = onselectionchange;
}

/**
 * Gets the "innerText" of a text node using the Selection API
 *
 * NOTE: For performance reasons, since this function will be called multiple times while calculating the innerText of
 *       an element, it does not restore the current selection.
 * @param textNode
 */
function getTextNodeInnerText(textNode: Node): string {
    const selection = getWindowSelection(textNode);

    if (selection === null) {
        return textNode.textContent || '';
    }

    selection.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(textNode);
    selection.addRange(range);
    const text = selection.toString();

    return text;
}

const nodeIsElement = (node: Node): node is Element => node.nodeType === ELEMENT_NODE;

function innerTextCollectionSteps(node: Node): InnerTextCollectionResult[] {
    const result: InnerTextCollectionResult[] = [];

    node.childNodes.forEach((childNode) => {
        ArrayPush.apply(result, innerTextCollectionSteps(childNode));
    });

    if (nodeIsElement(node)) {
        const tagName = node.tagName;
        const computedStyle = getElementComputedStyle(node);

        // 2. If node's computed value of 'visibility' is not 'visible', then return items.
        if (computedStyle.visibility !== 'visible') {
            return result;
        }

        // 3. If node is not being rendered, then return items. @todo: handle exceptions: select, optgroup, option
        if (
            !nodeIsBeingRendered(computedStyle) &&
            tagName !== 'SELECT' &&
            tagName !== 'OPTGROUP' &&
            tagName !== 'OPTION'
        ) {
            return result;
        }

        // 5. If node is a br element, then append a string containing a single U+000A LINE FEED (LF) character to items.
        if (tagName === 'BR') {
            result.push('\n');
        }

        // 6. If node's computed value of 'display' is 'table-cell', and node's CSS box is not the last 'table-cell' box of its enclosing 'table-row' box, then append a string containing a single U+0009 CHARACTER TABULATION (tab) character to items.
        if (computedStyle.display === 'table-cell') {
            // omitting case: and node's CSS box is not the last 'table-cell' box of its enclosing 'table-row' box
            result.push('\t');
        }

        // 7. If node's computed value of 'display' is 'table-row', and node's CSS box is not the last 'table-row' box of the nearest ancestor 'table' box, then append a string containing a single U+000A LINE FEED (LF) character to items.
        if (computedStyle.display === 'table-row') {
            // omitting case: and node's CSS box is not the last 'table-row' box of the nearest ancestor 'table' box
            result.push('\n');
        }

        // 8. If node is a p element, then append 2 (a required line break count) at the beginning and end of items.
        if (tagName === 'P') {
            result.unshift(2);
            result.push(2);
        }

        // 9. If node's used value of 'display' is block-level or 'table-caption', then append 1 (a required line break count) at the beginning and end of items.
        if (computedStyle.display === 'block' || computedStyle.display === 'table-caption') {
            result.unshift(1);
            result.push(1);
        }
    } else if (node.nodeType === TEXT_NODE) {
        result.push(getTextNodeInnerText(node));
    }

    return result;
}

/**
 * innerText spec: https://html.spec.whatwg.org/multipage/dom.html#the-innertext-idl-attribute
 */
function innerTextPatched(this: Element): string {
    const thisComputedStyle = getElementComputedStyle(this);
    // 1. If this is not being rendered or if the user agent is a non-CSS user agent, then return this's descendant text content.
    if (!nodeIsBeingRendered(thisComputedStyle)) {
        return textContentGetterPatched.call(this);
    }

    const selectionState = getSelectionState(this);

    // 2. Let results be a new empty list.
    let results: InnerTextCollectionResult[] = [];
    // 3. For each child node node of this:
    const childNodes = childNodesGetterPatched.call(this);
    childNodes.forEach((childNode) => {
        //   3.1 Let current be the list resulting in running the inner text collection steps with node. Each item in results will either be a string or a positive integer (a required line break count).
        //   3.2 For each item item in current, append item to results.
        ArrayPush.apply(results, innerTextCollectionSteps(childNode));
    });

    restoreSelectionState(selectionState);

    // 4. Remove any items from results that are the empty string.
    results = results.filter((result) => typeof result === 'number' || result.length > 0);

    // 5. Remove any runs of consecutive required line break count items at the start or end of results.
    let start = 0;
    let end = results.length - 1;
    let maxInSequence;
    let elementInnerText = '';

    while (typeof results[start] === 'number' && start <= end) start++;
    while (typeof results[end] === 'number' && end > start) end--;

    // 6. Replace each remaining run of consecutive required line break count items with a string consisting of as many U+000A LINE FEED (LF) characters as the maximum of the values in the required line break count items.
    while (start <= end) {
        const partialResult = results[start];

        if (typeof partialResult === 'number') {
            maxInSequence = partialResult;
            // loop will end because all numbers were removed from the end of results.
            while (typeof results[start + 1] === 'number') {
                start++;
                maxInSequence = Math.max(maxInSequence, results[start] as number);
            }

            elementInnerText += maxInSequence === 1 ? '\n' : '\n\n';
        } else {
            elementInnerText += partialResult;
        }

        start++;
    }
    // 7. Return the concatenation of the string items in results.

    return elementInnerText;
}

function innerHTMLGetterPatched(this: Element): string {
    const childNodes = getInternalChildNodes(this);
    let innerHTML = '';
    for (let i = 0, len = childNodes.length; i < len; i += 1) {
        innerHTML += getOuterHTML(childNodes[i]);
    }
    return innerHTML;
}

function outerHTMLGetterPatched(this: Element) {
    return getOuterHTML(this);
}

function attachShadowPatched(this: Element, options: ShadowRootInit): ShadowRoot {
    // To retain native behavior of the API, provide synthetic shadowRoot only when specified
    if (isTrue((options as any)['$$lwc-synthetic-mode$$'])) {
        return attachShadow(this, options);
    } else {
        return originalAttachShadow.call(this, options);
    }
}

function shadowRootGetterPatched(this: Element): ShadowRoot | null {
    if (isHostElement(this)) {
        const shadow = getShadowRoot(this);
        if (shadow.mode === 'open') {
            return shadow;
        }
    }
    return originalShadowRootGetter.call(this);
}

function childrenGetterPatched(this: Element): HTMLCollectionOf<Element> {
    const owner = getNodeOwner(this);
    const childNodes = isNull(owner) ? [] : getAllMatches(owner, getFilteredChildNodes(this));
    return createStaticHTMLCollection(
        ArrayFilter.call(childNodes, (node: Node | Element) => node instanceof Element)
    );
}

function childElementCountGetterPatched(this: ParentNode) {
    return this.children.length;
}

function firstElementChildGetterPatched(this: ParentNode) {
    return this.children[0] || null;
}

function lastElementChildGetterPatched(this: ParentNode) {
    const { children } = this;
    return children.item(children.length - 1) || null;
}

defineProperties(HTMLElement.prototype, {
    innerText: {
        get(this: Element): string {
            if (!featureFlags.ENABLE_ELEMENT_PATCH) {
                if (isNodeShadowed(this) || isHostElement(this)) {
                    return innerTextPatched.call(this);
                }

                return innerTextGetter.call(this);
            }

            // TODO [#1222]: remove global bypass
            if (isGlobalPatchingSkipped(this)) {
                return innerTextGetter.call(this);
            }
            return innerTextPatched.call(this);
        },
        set(v: string) {
            innerTextSetter.call(this, v);
        },
        enumerable: true,
        configurable: true,
    },
    outerText: {
        get(this: Element): string {
            if (!featureFlags.ENABLE_ELEMENT_PATCH) {
                if (isNodeShadowed(this) || isHostElement(this)) {
                    return innerTextPatched.call(this);
                }

                return outerTextGetter.call(this);
            }

            // TODO [#1222]: remove global bypass
            if (isGlobalPatchingSkipped(this)) {
                return outerTextGetter.call(this);
            }
            return innerTextPatched.call(this);
        },
        set(v: string) {
            outerTextSetter.call(this, v);
        },
        enumerable: true,
        configurable: true,
    },
});

// Non-deep-traversing patches: this descriptor map includes all descriptors that
// do not five access to nodes beyond the immediate children.
defineProperties(Element.prototype, {
    innerHTML: {
        get(this: Element): string {
            if (!featureFlags.ENABLE_ELEMENT_PATCH) {
                if (isNodeShadowed(this) || isHostElement(this)) {
                    return innerHTMLGetterPatched.call(this);
                }

                return innerHTMLGetter.call(this);
            }

            // TODO [#1222]: remove global bypass
            if (isGlobalPatchingSkipped(this)) {
                return innerHTMLGetter.call(this);
            }
            return innerHTMLGetterPatched.call(this);
        },
        set(v: string) {
            innerHTMLSetter.call(this, v);
        },
        enumerable: true,
        configurable: true,
    },
    outerHTML: {
        get(this: Element): string {
            if (!featureFlags.ENABLE_ELEMENT_PATCH) {
                if (isNodeShadowed(this) || isHostElement(this)) {
                    return outerHTMLGetterPatched.call(this);
                }
                return outerHTMLGetter.call(this);
            }

            // TODO [#1222]: remove global bypass
            if (isGlobalPatchingSkipped(this)) {
                return outerHTMLGetter.call(this);
            }
            return outerHTMLGetterPatched.call(this);
        },
        set(v: string) {
            outerHTMLSetter.call(this, v);
        },
        enumerable: true,
        configurable: true,
    },
    attachShadow: {
        value: attachShadowPatched,
        enumerable: true,
        writable: true,
        configurable: true,
    },
    shadowRoot: {
        get: shadowRootGetterPatched,
        enumerable: true,
        configurable: true,
    },
    // patched in HTMLElement if exists (IE11 is the one off here)
    children: {
        get(this: Element): HTMLCollectionOf<Element> {
            if (hasMountedChildren(this)) {
                return childrenGetterPatched.call(this);
            }
            return childrenGetter.call(this);
        },
        enumerable: true,
        configurable: true,
    },
    childElementCount: {
        get(this: Element): number {
            if (hasMountedChildren(this)) {
                return childElementCountGetterPatched.call(this);
            }
            return childElementCountGetter.call(this);
        },
        enumerable: true,
        configurable: true,
    },
    firstElementChild: {
        get(this: Element): Element | null {
            if (hasMountedChildren(this)) {
                return firstElementChildGetterPatched.call(this);
            }
            return firstElementChildGetter.call(this);
        },
        enumerable: true,
        configurable: true,
    },
    lastElementChild: {
        get(this: Element): Element | null {
            if (hasMountedChildren(this)) {
                return lastElementChildGetterPatched.call(this);
            }
            return lastElementChildGetter.call(this);
        },
        enumerable: true,
        configurable: true,
    },
    assignedSlot: {
        get: assignedSlotGetterPatched,
        enumerable: true,
        configurable: true,
    },
});

// IE11 extra patches for wrong prototypes
if (hasOwnProperty.call(HTMLElement.prototype, 'innerHTML')) {
    defineProperty(
        HTMLElement.prototype,
        'innerHTML',
        getOwnPropertyDescriptor(Element.prototype, 'innerHTML') as PropertyDescriptor
    );
}
if (hasOwnProperty.call(HTMLElement.prototype, 'outerHTML')) {
    defineProperty(
        HTMLElement.prototype,
        'outerHTML',
        getOwnPropertyDescriptor(Element.prototype, 'outerHTML') as PropertyDescriptor
    );
}
if (hasOwnProperty.call(HTMLElement.prototype, 'children')) {
    defineProperty(
        HTMLElement.prototype,
        'children',
        getOwnPropertyDescriptor(Element.prototype, 'children') as PropertyDescriptor
    );
}

// Deep-traversing patches from this point on:

function querySelectorPatched(this: Element /*, selector: string*/): Element | null {
    const nodeList = arrayFromCollection(
        elementQuerySelectorAll.apply(this, ArraySlice.call(arguments) as [string])
    );
    if (isHostElement(this)) {
        // element with shadowRoot attached
        const owner = getNodeOwner(this);
        if (isNull(owner)) {
            return null;
        } else if (getNodeKey(this)) {
            // it is a custom element, and we should then filter by slotted elements
            return getFirstSlottedMatch(this, nodeList);
        } else {
            // regular element, we should then filter by ownership
            return getFirstMatch(owner, nodeList);
        }
    } else if (isNodeShadowed(this)) {
        // element inside a shadowRoot
        const ownerKey = getNodeOwnerKey(this);
        if (!isUndefined(ownerKey)) {
            // `this` is handled by lwc, using getNodeNearestOwnerKey to include manually inserted elements in the same shadow.
            const elm = ArrayFind.call(nodeList, (elm) => getNodeNearestOwnerKey(elm) === ownerKey);
            return isUndefined(elm) ? null : elm;
        } else {
            if (!featureFlags.ENABLE_NODE_LIST_PATCH) {
                // `this` is a manually inserted element inside a shadowRoot, return the first element.
                return nodeList.length === 0 ? null : nodeList[0];
            }

            // Element is inside a shadow but we dont know which one. Use the
            // "nearest" owner key to filter by ownership.
            const contextNearestOwnerKey = getNodeNearestOwnerKey(this);
            const elm = ArrayFind.call(
                nodeList,
                (elm) => getNodeNearestOwnerKey(elm) === contextNearestOwnerKey
            );
            return isUndefined(elm) ? null : elm;
        }
    } else {
        if (!featureFlags.ENABLE_NODE_LIST_PATCH) {
            if (!(this instanceof HTMLBodyElement)) {
                const elm = nodeList[0];
                return isUndefined(elm) ? null : elm;
            }
        }

        // element belonging to the document
        const elm = ArrayFind.call(
            nodeList,
            // TODO [#1222]: remove global bypass
            (elm) => isUndefined(getNodeOwnerKey(elm)) || isGlobalPatchingSkipped(this)
        );
        return isUndefined(elm) ? null : elm;
    }
}

function getFilteredArrayOfNodes<T extends Node>(
    context: Element,
    unfilteredNodes: T[],
    shadowDomSemantic: ShadowDomSemantic
): T[] {
    let filtered: T[];
    if (isHostElement(context)) {
        // element with shadowRoot attached
        const owner = getNodeOwner(context);
        if (isNull(owner)) {
            filtered = [];
        } else if (getNodeKey(context)) {
            // it is a custom element, and we should then filter by slotted elements
            filtered = getAllSlottedMatches(context, unfilteredNodes);
        } else {
            // regular element, we should then filter by ownership
            filtered = getAllMatches(owner, unfilteredNodes);
        }
    } else if (isNodeShadowed(context)) {
        // element inside a shadowRoot
        const ownerKey = getNodeOwnerKey(context);
        if (!isUndefined(ownerKey)) {
            // context is handled by lwc, using getNodeNearestOwnerKey to include manually inserted elements in the same shadow.
            filtered = ArrayFilter.call(
                unfilteredNodes,
                (elm) => getNodeNearestOwnerKey(elm) === ownerKey
            );
        } else if (shadowDomSemantic === ShadowDomSemantic.Enabled) {
            // context is inside a shadow, we dont know which one.
            const contextNearestOwnerKey = getNodeNearestOwnerKey(context);
            filtered = ArrayFilter.call(
                unfilteredNodes,
                (elm) => getNodeNearestOwnerKey(elm) === contextNearestOwnerKey
            );
        } else {
            // context is manually inserted without lwc:dom-manual and ShadowDomSemantics is off, return everything
            filtered = ArraySlice.call(unfilteredNodes);
        }
    } else {
        if (context instanceof HTMLBodyElement || shadowDomSemantic === ShadowDomSemantic.Enabled) {
            // `context` is document.body or element belonging to the document with the patch enabled
            filtered = ArrayFilter.call(
                unfilteredNodes,
                // TODO [#1222]: remove global bypass
                (elm) => isUndefined(getNodeOwnerKey(elm)) || isGlobalPatchingSkipped(context)
            );
        } else {
            // `context` is outside the lwc boundary and patch is not enabled.
            filtered = ArraySlice.call(unfilteredNodes);
        }
    }
    return filtered;
}

// The following patched methods hide shadowed elements from global
// traversing mechanisms. They are simplified for performance reasons to
// filter by ownership and do not account for slotted elements. This
// compromise is fine for our synthetic shadow dom because root elements
// cannot have slotted elements.
// Another compromise here is that all these traversing methods will return
// static HTMLCollection or static NodeList. We decided that this compromise
// is not a big problem considering the amount of code that is relying on
// the liveliness of these results are rare.
defineProperties(Element.prototype, {
    querySelector: {
        value: querySelectorPatched,
        writable: true,
        enumerable: true,
        configurable: true,
    },
    querySelectorAll: {
        value(this: HTMLBodyElement): NodeListOf<Element> {
            const nodeList = arrayFromCollection(
                elementQuerySelectorAll.apply(this, ArraySlice.call(arguments) as [string])
            );

            if (!featureFlags.ENABLE_NODE_LIST_PATCH) {
                const filteredResults = getFilteredArrayOfNodes(
                    this,
                    nodeList,
                    ShadowDomSemantic.Disabled
                );
                return createStaticNodeList(filteredResults);
            }

            return createStaticNodeList(
                getFilteredArrayOfNodes(this, nodeList, ShadowDomSemantic.Enabled)
            );
        },
        writable: true,
        enumerable: true,
        configurable: true,
    },
});

// The following APIs are used directly by Jest internally so we avoid patching them during testing.
if (process.env.NODE_ENV !== 'test') {
    defineProperties(Element.prototype, {
        getElementsByClassName: {
            value(this: HTMLBodyElement): HTMLCollectionOf<Element> {
                const elements = arrayFromCollection(
                    elementGetElementsByClassName.apply(
                        this,
                        ArraySlice.call(arguments) as [string]
                    )
                ) as Element[];

                if (!featureFlags.ENABLE_HTML_COLLECTIONS_PATCH) {
                    return createStaticHTMLCollection(
                        getNonPatchedFilteredArrayOfNodes(this, elements)
                    );
                }

                const filteredResults = getFilteredArrayOfNodes(
                    this,
                    elements,
                    ShadowDomSemantic.Enabled
                );
                return createStaticHTMLCollection(filteredResults);
            },
            writable: true,
            enumerable: true,
            configurable: true,
        },
        getElementsByTagName: {
            value(this: HTMLBodyElement): HTMLCollectionOf<Element> {
                const elements = arrayFromCollection(
                    elementGetElementsByTagName.apply(this, ArraySlice.call(arguments) as [string])
                ) as Element[];

                if (!featureFlags.ENABLE_HTML_COLLECTIONS_PATCH) {
                    return createStaticHTMLCollection(
                        getNonPatchedFilteredArrayOfNodes(this, elements)
                    );
                }

                const filteredResults = getFilteredArrayOfNodes(
                    this,
                    elements,
                    ShadowDomSemantic.Enabled
                );
                return createStaticHTMLCollection(filteredResults);
            },
            writable: true,
            enumerable: true,
            configurable: true,
        },
        getElementsByTagNameNS: {
            value(this: HTMLBodyElement): HTMLCollectionOf<Element> {
                const elements = arrayFromCollection(
                    elementGetElementsByTagNameNS.apply(
                        this,
                        ArraySlice.call(arguments) as [string, string]
                    )
                ) as Element[];

                if (!featureFlags.ENABLE_HTML_COLLECTIONS_PATCH) {
                    return createStaticHTMLCollection(
                        getNonPatchedFilteredArrayOfNodes(this, elements)
                    );
                }

                const filteredResults = getFilteredArrayOfNodes(
                    this,
                    elements,
                    ShadowDomSemantic.Enabled
                );
                return createStaticHTMLCollection(filteredResults);
            },
            writable: true,
            enumerable: true,
            configurable: true,
        },
    });
}

// IE11 extra patches for wrong prototypes
if (hasOwnProperty.call(HTMLElement.prototype, 'getElementsByClassName')) {
    defineProperty(
        HTMLElement.prototype,
        'getElementsByClassName',
        getOwnPropertyDescriptor(Element.prototype, 'getElementsByClassName') as PropertyDescriptor
    );
}
