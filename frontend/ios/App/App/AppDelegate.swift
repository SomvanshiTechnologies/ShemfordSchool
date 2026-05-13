import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Detect hardware screenshots on iOS and notify the React web layer
        NotificationCenter.default.addObserver(
            forName: UIApplication.userDidTakeScreenshotNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.notifyWebLayerOfScreenshot()
        }
        return true
    }

    private func notifyWebLayerOfScreenshot() {
        guard let rootVC = window?.rootViewController else { return }
        if let bridgeVC = findBridgeViewController(in: rootVC) {
            bridgeVC.bridge?.webView?.evaluateJavaScript(
                "window.dispatchEvent(new Event('screenshotTaken'))"
            )
        }
    }

    private func findBridgeViewController(in vc: UIViewController) -> CAPBridgeViewController? {
        if let bridge = vc as? CAPBridgeViewController { return bridge }
        for child in vc.children {
            if let found = findBridgeViewController(in: child) { return found }
        }
        return nil
    }

    func applicationWillResignActive(_ application: UIApplication) {}
    func applicationDidEnterBackground(_ application: UIApplication) {}
    func applicationWillEnterForeground(_ application: UIApplication) {}
    func applicationDidBecomeActive(_ application: UIApplication) {}
    func applicationWillTerminate(_ application: UIApplication) {}

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}
