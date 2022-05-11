import Handlebars from "handlebars";
import { Utils } from "./Utils";

export class Setup {
    public static initHandlebars() {

        Handlebars.registerHelper('excerpt', (...args) => {
            if (args.length > 2) {
                let text: any = args[0];
                let maxLength: any = parseInt(args[1]);
                let ellipsis: any = undefined;
                if (args.length > 3) {
                    return Utils.excerpt(text, parseInt(maxLength), ellipsis);
                }
            }
            return args[0];
        });

        Handlebars.registerHelper('currentDate', Utils.getCurrentDate);
    }
}