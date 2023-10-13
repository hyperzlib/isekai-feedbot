import App from "./App";

interface ImportMeta {
    context: {
        isekaiFeedbotApp: App;
    }
}

declare module "bson" {
    interface ObjectId {
      _id: this;
    }
}