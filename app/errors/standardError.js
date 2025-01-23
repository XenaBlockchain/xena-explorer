export default class StandardError extends Error {
	constructor(error) {
		super(error?.message || "Unknown error");

		this.name = "StandardError";
		this.id = error?.id || null;
		this.userData = error?.userData || null
	}

	toString() {
		return `${this.name}: ${this.message} (Code: ${this.code}, ID: ${this.id})`;
	}
}
