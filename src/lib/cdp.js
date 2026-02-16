class CDP {
    constructor(page) {
        this.page = page;
        this.client = null;
        this.ready = false;
        this.maxRetries = 3;

        // IMPORTANT: Facebook swaps renderer frequently
        this.page.on('framenavigated', () => {
            this.ready = false;
        });

        this.page.on('close', () => {
            this.ready = false;
        });
    }

    async init() {

        // Always create fresh session
        this.client = await this.page.target().createCDPSession();

        // Enable domains explicitly (required for cookies/network)
        await Promise.all([
            this.client.send("Network.enable").catch(()=>{}),
            this.client.send("Page.enable").catch(()=>{}),
            this.client.send("Runtime.enable").catch(()=>{})
        ]);

        this.ready = true;
    }

    async ensure() {

        if (!this.ready || !(await this.isHealthy())) {
            await this.init();
        }
    }

    async withRetry(operation) {

        let lastError;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {

            try {

                await this.ensure();
                return await operation();

            } catch (e) {

                lastError = e;
                this.ready = false;

                if (attempt < this.maxRetries) {

                    // exponential backoff
                    await new Promise(r =>
                        setTimeout(r, 120 * Math.pow(2, attempt - 1))
                    );

                }
            }
        }

        throw lastError;
    }

    async isHealthy() {

        if (!this.client) return false;

        try {

            await this.client.send("Runtime.evaluate", {
                expression: "1+1"
            });

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

            return this.withRetry(async () => {

                return this.client.send(
                    "Network.setCookies",
                    { cookies }
                );
            });
        },

        deleteCookies: async (cookies) => {

            return this.withRetry(async () => {

                for (const c of cookies) {

                    const params = { name: c.name };

                    // DevTools requires EITHER url OR domain/path
                    if (c.url) {
                        params.url = c.url;
                    } else {
                        params.domain = c.domain;
                        params.path = c.path || "/";
                    }

                    await this.client.send(
                        "Network.deleteCookies",
                        params
                    );
                }
            });
        },

        clearAllCookies: async () => {

            const cookies = await this.Network.getCookies();

            if (cookies.length) {
                await this.Network.deleteCookies(cookies);
            }
        }
    };
}

module.exports = CDP;
