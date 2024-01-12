export function label(name: string) {
    return {
        _type: 'label',
        label: name,
        toString: () => {
            return name;
        }
    };
}