import { innerTextGetter } from 'browser-env';
import { createElement } from 'lwc';
import Container from 'x/container';

if (!process.env.NATIVE_SHADOW) {
    describe('innerText', () => {
        const elm = createElement('x-container', { is: Container });
        document.body.appendChild(elm);

        return Promise.resolve().then(() => {
            const testCases = elm.shadowRoot.querySelectorAll('.test-case');

            testCases.forEach((testCaseElement) => {
                it(testCaseElement.getAttribute('data-desc'), () => {
                    expect(testCaseElement.innerText).toBe(innerTextGetter.call(testCaseElement));
                });
            });

            it('should not go inside custom element shadow', () => {
                const testElement = elm.shadowRoot.querySelector('.without-slotted-content');

                expect(testElement.innerText).toBe('first text\nsecond text');
            });

            it('should process custom elements light dom', () => {
                const testElement = elm.shadowRoot.querySelector('.with-slotted-content');

                expect(testElement.innerText).toBe('first text\n\nslotted element\n\nsecond text');
            });

            it('should process custom elements light dom across multiple shadows', () => {
                const testElement = elm.shadowRoot.querySelector('.with-slotted-content-2-levels');

                expect(testElement.innerText).toBe('first text\n\nslotted element\n\nsecond text');
            });
        });
    });
}
