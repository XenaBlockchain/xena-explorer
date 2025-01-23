export default class RpcError extends Error{
	constructor(error) {
		let errorObj = null
		try {
			errorObj = JSON.parse(error.message)
		} catch (e) {
			return
		}
		super(errorObj.error.message)
		this.name = "RPCError";
		this.message = errorObj?.error.message
		this.code = errorObj?.error.code || null;
		this.result = errorObj?.result || null;
		this.id = errorObj.id || null;
		this.userData = error.userData

	}

	toString() {
		return `${this.name}: ${this.message} (Code: ${this.code}, ID: ${this.id})`;
	}

	toObject() {
		return Object.assign({}, this);
	}
}
