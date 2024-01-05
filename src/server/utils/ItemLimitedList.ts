export class ItemLimitedList<T = any> extends Array<T> {
    private _maxLength: number;

    constructor(maxLength: number) {
        super();
        this._maxLength = maxLength;
    }

    get maxLength() {
        return this._maxLength;
    }

    set maxLength(value: number) {
        this._maxLength = value;
        if (this.length > this.maxLength) {
            let offset = this.length - this.maxLength;
            this.splice(0, offset);
        }
    }

    /** 添加元素 */
    addOne(item: T) {
        if (this.length + 1 >= this.maxLength) {
            this.shift();
        }
        this.push(item);
    }
}