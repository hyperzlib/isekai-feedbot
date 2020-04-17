class Utils {
    static dictJoin(dict, d1 = ": ", d2 = "\n"){
        let lines = [];
        for(var key in dict){
            let value = dict[key];
            lines.push(key + d1 + value);
        }
        return lines.join(d2);
    }

    static getCurrentDate(){
        let date = new Date();
        return date.getFullYear() + '年' + date.getMonth() + '月' + date.getDate() + '日';
    }
}

module.exports = Utils;