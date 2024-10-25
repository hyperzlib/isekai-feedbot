import { observe, reactive } from "#ibot/utils";

const testObj = reactive({
    a: 1,
    deepObj: {
        a: 1,
    },
    nestedObj: reactive({
        a: 1,
    }),
});

console.log(testObj);

observe(testObj, (key, value) => {
    console.log('change:', key, value);
});

testObj.a = 2;
testObj.deepObj.a = 2;
testObj.nestedObj.a = 2;