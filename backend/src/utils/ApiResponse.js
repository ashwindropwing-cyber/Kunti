class ApiResponse {
    constructor(statusCode, message = "Success", data = null) {
        this.statusCode = statusCode;
        this.message = message;
        this.data = data;
        this.success = statusCode < 400;
    }

    static success(res, data, message = "Success", statusCode = 200) {
        return res.status(statusCode).json(new ApiResponse(statusCode, message, data));
    }

    static error(res, message = "Error", statusCode = 500, data = null) {
        return res.status(statusCode).json(new ApiResponse(statusCode, message, data));
    }

    // 🕵️ COMPATIBILITY LAYER: If this is sent via res.json(), 
    // it will now return the RAW DATA directly so Flutter apps don't break.
    toJSON() {
        // For successful responses, return data directly.
        // For error responses, return the full object so they can see the message.
        if (this.statusCode >= 200 && this.statusCode < 300) {
            // If data is null/undefined, return { message } so Flutter can still read the response
            if (this.data === null || this.data === undefined) {
                return { message: this.message };
            }
            return this.data;
        }
        return {
            success: this.success,
            message: this.message,
            statusCode: this.statusCode,
            data: this.data
        };
    }
}

module.exports = ApiResponse;
