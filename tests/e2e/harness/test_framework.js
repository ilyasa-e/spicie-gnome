/**
 * Lightweight, zero-dependency async test framework for GJS and Node.js.
 */

let GLib = null;
try {
    const mod = await import('gi://GLib');
    GLib = mod.default;
} catch (e) {}

export async function sleep(ms) {
    if (GLib && GLib.MainLoop) {
        const loop = new GLib.MainLoop(null, false);
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            loop.quit();
            return GLib.SOURCE_REMOVE;
        });
        loop.run();
    } else {
        await new Promise(r => setTimeout(r, ms));
    }
}

class Expectation {

    constructor(actual, isNot = false) {
        this.actual = actual;
        this.isNot = isNot;
    }

    get not() {
        return new Expectation(this.actual, !this.isNot);
    }

    _assert(pass, message) {
        if (this.isNot ? pass : !pass) {
            throw new Error(this.isNot ? `Expected NOT: ${message}` : `Assertion failed: ${message}`);
        }
    }

    toBe(expected) {
        this._assert(
            Object.is(this.actual, expected),
            `expected ${JSON.stringify(this.actual)} to be ${JSON.stringify(expected)}`
        );
    }

    toEqual(expected) {
        const actualStr = JSON.stringify(this.actual);
        const expectedStr = JSON.stringify(expected);
        this._assert(
            actualStr === expectedStr,
            `expected ${actualStr} to equal ${expectedStr}`
        );
    }

    toBeCloseTo(expected, delta = 0.01) {
        const pass = Math.abs(this.actual - expected) <= delta;
        this._assert(pass, `expected ${this.actual} to be close to ${expected} (within ${delta})`);
    }

    toBeGreaterThan(expected) {
        this._assert(this.actual > expected, `expected ${this.actual} > ${expected}`);
    }

    toBeGreaterThanOrEqual(expected) {
        this._assert(this.actual >= expected, `expected ${this.actual} >= ${expected}`);
    }

    toBeLessThan(expected) {
        this._assert(this.actual < expected, `expected ${this.actual} < ${expected}`);
    }

    toBeLessThanOrEqual(expected) {
        this._assert(this.actual <= expected, `expected ${this.actual} <= ${expected}`);
    }

    toContain(item) {
        let pass = false;
        if (typeof this.actual === 'string' || Array.isArray(this.actual)) {
            pass = this.actual.includes(item);
        } else if (this.actual instanceof Set || this.actual instanceof Map) {
            pass = this.actual.has(item);
        }
        this._assert(pass, `expected ${JSON.stringify(this.actual)} to contain ${JSON.stringify(item)}`);
    }

    toBeNull() {
        this._assert(this.actual === null, `expected ${this.actual} to be null`);
    }

    toBeDefined() {
        this._assert(this.actual !== undefined, `expected value to be defined`);
    }

    toBeUndefined() {
        this._assert(this.actual === undefined, `expected ${this.actual} to be undefined`);
    }

    toBeTruthy() {
        this._assert(Boolean(this.actual), `expected ${this.actual} to be truthy`);
    }

    toBeFalsy() {
        this._assert(!Boolean(this.actual), `expected ${this.actual} to be falsy`);
    }

    toMatch(regex) {
        const pass = regex.test(String(this.actual));
        this._assert(pass, `expected "${this.actual}" to match ${regex}`);
    }

    toThrow(expectedMessageSubstr) {
        let threw = false;
        let thrownError = null;
        if (typeof this.actual !== 'function') {
            throw new Error(`toThrow requires a function input`);
        }
        try {
            this.actual();
        } catch (e) {
            threw = true;
            thrownError = e;
        }

        if (expectedMessageSubstr && threw) {
            const matches = String(thrownError.message || thrownError).includes(expectedMessageSubstr);
            this._assert(matches, `expected error message "${thrownError.message}" to include "${expectedMessageSubstr}"`);
        } else {
            this._assert(threw, `expected function to throw an error`);
        }
    }
}

export class TestSuite {
    constructor() {
        this.suites = [];
        this.currentSuite = null;
        this.totalPasses = 0;
        this.totalFails = 0;
        this.totalSkips = 0;
        this.startTime = 0;
    }

    describe(name, fn) {
        const suite = {
            name,
            tests: [],
            beforeEachHooks: [],
            afterEachHooks: []
        };
        const prevSuite = this.currentSuite;
        this.currentSuite = suite;
        this.suites.push(suite);
        try {
            fn();
        } finally {
            this.currentSuite = prevSuite;
        }
    }

    it(name, testFn) {
        if (!this.currentSuite) {
            this.describe('Default Suite', () => {
                this.currentSuite.tests.push({ name, testFn, skip: false });
            });
            return;
        }
        this.currentSuite.tests.push({ name, testFn, skip: false });
    }

    xit(name, testFn) {
        if (this.currentSuite) {
            this.currentSuite.tests.push({ name, testFn, skip: true });
        }
    }

    beforeEach(fn) {
        if (this.currentSuite) {
            this.currentSuite.beforeEachHooks.push(fn);
        }
    }

    afterEach(fn) {
        if (this.currentSuite) {
            this.currentSuite.afterEachHooks.push(fn);
        }
    }

    async run() {
        this.startTime = Date.now();
        console.log(`\n======================================================`);
        console.log(` Starting E2E Test Suite Execution`);
        console.log(`======================================================\n`);

        for (const suite of this.suites) {
            console.log(`\x1b[1m\x1b[36m▶ Suite: ${suite.name}\x1b[0m`);
            for (const test of suite.tests) {
                if (test.skip) {
                    this.totalSkips++;
                    console.log(`  \x1b[33m- [SKIP] ${test.name}\x1b[0m`);
                    continue;
                }

                try {
                    for (const hook of suite.beforeEachHooks) {
                        await hook();
                    }

                    const testStart = Date.now();
                    await test.testFn();
                    const testDuration = Date.now() - testStart;

                    this.totalPasses++;
                    console.log(`  \x1b[32m✔ [PASS]\x1b[0m ${test.name} \x1b[90m(${testDuration}ms)\x1b[0m`);
                } catch (err) {
                    this.totalFails++;
                    console.log(`  \x1b[31m✖ [FAIL]\x1b[0m ${test.name}`);
                    console.log(`    \x1b[31mError: ${err.message || err}\x1b[0m`);
                    if (err.stack) {
                        const filteredStack = err.stack.split('\n').slice(0, 4).join('\n    ');
                        console.log(`    \x1b[90m${filteredStack}\x1b[0m`);
                    }
                } finally {
                    for (const hook of suite.afterEachHooks) {
                        try {
                            await hook();
                        } catch (hErr) {
                            console.log(`    \x1b[31mAfterEach Hook Error: ${hErr.message}\x1b[0m`);
                        }
                    }
                }
            }
        }

        const totalDuration = ((Date.now() - this.startTime) / 1000).toFixed(2);
        console.log(`\n------------------------------------------------------`);
        console.log(` Execution Summary:`);
        console.log(` Total Suites: ${this.suites.length}`);
        console.log(` Total Tests:  ${this.totalPasses + this.totalFails + this.totalSkips}`);
        console.log(`   \x1b[32m✔ Passed:   ${this.totalPasses}\x1b[0m`);
        console.log(`   \x1b[31m✖ Failed:   ${this.totalFails}\x1b[0m`);
        console.log(`   \x1b[33m- Skipped:  ${this.totalSkips}\x1b[0m`);
        console.log(` Duration:     ${totalDuration}s`);
        console.log(`======================================================\n`);

        return {
            passed: this.totalFails === 0,
            totalPasses: this.totalPasses,
            totalFails: this.totalFails,
            totalSkips: this.totalSkips,
            duration: totalDuration
        };
    }
}

export const defaultRunner = new TestSuite();
export const describe = (name, fn) => defaultRunner.describe(name, fn);
export const it = (name, fn) => defaultRunner.it(name, fn);
export const xit = (name, fn) => defaultRunner.xit(name, fn);
export const beforeEach = (fn) => defaultRunner.beforeEach(fn);
export const afterEach = (fn) => defaultRunner.afterEach(fn);
export const expect = (val) => new Expectation(val);
export const assert = (condition, msg) => {
    if (!condition) throw new Error(msg || "Assertion failed");
};
