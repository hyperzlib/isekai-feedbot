export interface Resource {
    initialize?(): Promise<void>;
    destroy?(): Promise<void>;
}