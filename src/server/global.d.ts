import App from "./App";

interface ImportMeta {
    _isekaiFeedbotApp: App;
}

declare module "bson" {
    interface ObjectId {
      _id: this;
    }
}