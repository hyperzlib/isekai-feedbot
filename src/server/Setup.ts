import Handlebars from "handlebars";
import { excerpt, getCurrentDate } from "./utils";
import Yaml from 'yaml';

export class Setup {
    public static async initHandlebars() {
        Handlebars.registerHelper('excerpt', (...args) => {
            if (args.length > 2) {
                let text: any = args[0];
                let maxLength: any = parseInt(args[1]);
                let ellipsis: any = undefined;
                if (args.length > 3) {
                    ellipsis = args[2];
                }
                excerpt(text, parseInt(maxLength), ellipsis);
            }
            return args[0];
        });

        Handlebars.registerHelper('currentDate', getCurrentDate);

        Handlebars.registerHelper('dump', (obj) => {
            return Yaml.stringify(obj);
        });
    }
}