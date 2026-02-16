class CDP {
    constructor(page) {
        this.page = page;
        this.client = null;
        this.ready = false;
        this.maxRetries = 2; // fewer retries, faster

        // Reset on FB renderer swap or page close
        this.page.on('framenavigated', () => {
            this.ready = false;
        });

        this.page.on('close', () => {
            this.ready = false;
        });
    }

    async init() {
        // Create a fresh CDP session
        this.client = await this.page.target().createCDPSession();

        // Enable necessary domains
        await Promise.all([
            this.client.send("Network.enable").catch(() => {}),
            this.client.send("Page.enable").catch(() => {}),
            this.client.send("Runtime.enable").catch(() => {})
        ]);

        this.ready = true;
    }

    // Ensure session ready, only init if not ready
    async ensure() {
        if (!this.ready) {
            await this.init();
        }
    }

    // Retry wrapper, only retries on failure
    async withRetry(operation) {
        let lastError;
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                await this.ensure();
                return await operation();
            } catch (e) {
                lastError = e;
                this.ready = false; // force re-init next retry
                if (attempt < this.maxRetries) {
                    await new Promise(r => setTimeout(r, 50 * attempt)); // small backoff
                }
            }
        }
        throw lastError;
    }

    // Fast health check (call only when needed)
    async isHealthy() {
        if (!this.client) return false;
        try {
            await this.client.send("Runtime.evaluate", { expression: "1+1" });
            return true;
        } catch {
            return false;
        }
    }

    Network = {

        getCookies: async (urls) => {
            return this.withRetry(async () => {
                const res = await this.client.send(
                    "Network.getCookies",
                    urls ? { urls } : {}
                );
                return res.cookies || [];
            });
        },

        setCookies: async (cookies) => {
            if (!cookies || !cookies.length) return;
            return this.withRetry(async () => {
                return this.client.send("Network.setCookies", { cookies });
            });
        },

        deleteCookies: async (cookies) => {
            if (!cookies || !cookies.length) return;
            return this.withRetry(async () => {
                // batch deletes for speed
                const ops = cookies.map(c => {
                    const params = { name: c.name };
                    if (c.url) params.url = c.url;
                    else {
                        params.domain = c.domain;
                        params.path = c.path || "/";
                    }
                    return this.client.send("Network.deleteCookies", params);
                });
                await Promise.all(ops);
            });
        },

        clearAllCookies: async () => {
            const cookies = await this.Network.getCookies();
            if (cookies.length > 0) {
                await this.Network.deleteCookies(cookies);
            }
        }
    };
}

module.exports = CDP;
