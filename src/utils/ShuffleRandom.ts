export class ShuffleRandom<T = string> {
    protected _itemList: T[];
    protected currentIndex = 0;

    constructor(itemList: T[] = []) {
        this._itemList = itemList;
        if (this._itemList.length > 0) {
            this.shuffle();
        }
    }

    public get itemList(): T[] {
        return this._itemList;
    }

    public set itemList(itemList: T[]) {
        this._itemList = itemList;
        this.shuffle();
    }

    public next(): T | null {
        if (this._itemList.length === 0) {
            return null;
        }
        let message = this._itemList[this.currentIndex];

        if (this.currentIndex === this._itemList.length - 1) {
            this.shuffle();
        } else {
            this.currentIndex++;
        }

        return message;
    }

    protected shuffle() {
        for (let i = 0; i < this._itemList.length; i++) {
            let j = Math.floor(Math.random() * (i + 1));
            [this._itemList[i], this._itemList[j]] = [this._itemList[j], this._itemList[i]];
        }
        this.currentIndex = 0;
    }
}