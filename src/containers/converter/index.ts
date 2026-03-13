import { Container, type StopParams } from "@cloudflare/containers";

export class ConverterContainer extends Container {
	defaultPort = 8080;
	requiredPorts = [8080];
	sleepAfter = "10m";
	entrypoint = ["/usr/local/bin/converter"];

	// constructor(ctx: Container["ctx"], env: Env) {
	// 	super(ctx, env);
	// 	void ctx.blockConcurrencyWhile(async () => {
	// 		return new Promise<void>((resolve, reject) => {
	// 			this.onStart = resolve;
	// 			this.onError = reject;
	// 			if (!ctx.container?.running) {
	// 				ctx.container?.start({
	// 					entrypoint: this.entrypoint,
	// 					enableInternet: true,
	// 				});
	// 			} else {
	// 				resolve();
	// 			}
	// 		});
	// 	});
	// }

	async fetch(request: Request): Promise<Response> {
		await this.startAndWaitForPorts({
			startOptions: {
				entrypoint: this.entrypoint,
				enableInternet: true,
			},
			ports: this.requiredPorts,
		});

		return super.fetch(request);
	}

	override onStart() {
		console.log("Container successfully started");
	}

	override onStop(stopParams: StopParams) {
		if (stopParams.exitCode === 0) {
			console.log("Container stopped gracefully");
		} else {
			console.log("Container stopped with exit code:", stopParams.exitCode);
		}

		console.log("Container stop reason:", stopParams.reason);
	}

	override onError(error: string) {
		console.log("Container error:", error);
	}
}
