const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const tests = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js') || f === 'AuthIntegration.test.js');

console.log(`Running ${tests.length} test files...`);

let passed = 0;
let failed = 0;

tests.forEach(test => {
    console.log(`\n--- Running ${test} ---`);
    try {
        // Run each test file. Use same env.
        execSync(`node tests/${test}`, { stdio: 'inherit' });
        passed++;
    } catch (e) {
        console.error(`FAILED: ${test}`);
        failed++;
    }
});

console.log(`\nSummary: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
