#!/usr/bin/env swift
// html2pdf.swift — Converts an HTML file to PDF using native macOS WebKit
// Usage: swift html2pdf.swift <input.html> <output.pdf>

import Cocoa
import WebKit

guard CommandLine.arguments.count == 3 else {
    fputs("Usage: html2pdf <input.html> <output.pdf>\n", stderr)
    exit(1)
}

let inputPath = CommandLine.arguments[1]
let outputPath = CommandLine.arguments[2]

guard let htmlString = try? String(contentsOfFile: inputPath, encoding: .utf8) else {
    fputs("Error: Cannot read \(inputPath)\n", stderr)
    exit(1)
}

class PDFPrinter: NSObject, WKNavigationDelegate {
    let outputURL: URL

    init(outputURL: URL) {
        self.outputURL = outputURL
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            let config = WKPDFConfiguration()
            config.rect = CGRect(x: 0, y: 0, width: 595, height: 842) // A4

            webView.createPDF(configuration: config) { result in
                switch result {
                case .success(let data):
                    do {
                        try data.write(to: self.outputURL)
                        print(self.outputURL.path)
                    } catch {
                        fputs("Error writing PDF: \(error)\n", stderr)
                    }
                case .failure(let error):
                    fputs("Error creating PDF: \(error)\n", stderr)
                }
                NSApplication.shared.terminate(nil)
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fputs("WebKit navigation failed: \(error)\n", stderr)
        NSApplication.shared.terminate(nil)
    }
}

let app = NSApplication.shared
let outputURL = URL(fileURLWithPath: outputPath)
let printer = PDFPrinter(outputURL: outputURL)

let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 595, height: 842))
webView.navigationDelegate = printer

let baseURL = URL(fileURLWithPath: inputPath).deletingLastPathComponent()
webView.loadHTMLString(htmlString, baseURL: baseURL)

// Timeout: exit after 10 seconds if nothing happens
DispatchQueue.main.asyncAfter(deadline: .now() + 10) {
    fputs("Timeout waiting for PDF generation\n", stderr)
    NSApplication.shared.terminate(nil)
}

app.run()
