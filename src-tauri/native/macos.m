#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>

typedef void (*AropytCallback)(void *, const unsigned char *, size_t, const char *);
@interface AropytRender : NSObject <WKNavigationDelegate>
@property WKWebView *web;
@property NSWindow *window;
@property NSString *mode;
@property NSPrintInfo *printInfo;
@property double requestedHeight;
@property double requestedWidth;
@property NSInteger tries;
@property NSString *output;
@property NSPrintOperation *operation;
@property void *context;
@property AropytCallback callback;
@end
static NSMutableSet *jobs;
@implementation AropytRender
- (void)finish:(NSData *)data error:(NSString *)error {
    if (!self.callback) return;
    self.callback(self.context, data.bytes, data.length, error ? error.UTF8String : NULL);
    self.callback = NULL;
    [self.window close]; self.web.navigationDelegate = nil; [jobs removeObject:self];
}
- (void)webView:(WKWebView *)web didFailNavigation:(WKNavigation *)nav withError:(NSError *)error { [self finish:nil error:error.localizedDescription]; }
- (void)webView:(WKWebView *)web didFailProvisionalNavigation:(WKNavigation *)nav withError:(NSError *)error { [self finish:nil error:error.localizedDescription]; }
- (void)webView:(WKWebView *)web didFinishNavigation:(WKNavigation *)nav { [self checkReady]; }
- (void)checkReady {
    [self.web evaluateJavaScript:@"document.fonts.status==='loaded' && Array.from(document.images).every(i=>i.complete)" completionHandler:^(id value, NSError *error) {
        if (error) { [self finish:nil error:error.localizedDescription]; return; }
        if (![value boolValue] && self.tries++ < 600) { dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 50*NSEC_PER_MSEC), dispatch_get_main_queue(), ^{[self checkReady];}); return; }
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100*NSEC_PER_MSEC), dispatch_get_main_queue(), ^{[self render];});
    }];
}
// NSPrintOperation may call its delegate on a printing worker. Keep all
// NSWindow/WebView lifetime operations on the main queue, after it returns.
- (void)printOperationDidRun:(NSPrintOperation *)operation success:(BOOL)success contextInfo:(void *)context {
    dispatch_async(dispatch_get_main_queue(), ^{
        self.operation=nil;
        if ([self.mode isEqualToString:@"print"]) {
            [self finish:[(success ? @"true" : @"false") dataUsingEncoding:NSUTF8StringEncoding] error:nil];
        } else {
            NSData *pdf=[NSData dataWithContentsOfFile:self.output];
            [[NSFileManager defaultManager] removeItemAtPath:self.output error:nil];
            [self finish:pdf error:pdf ? nil : @"PDF 导出失败"];
        }
    });
}
- (void)render {
    if ([self.mode isEqualToString:@"pdf"] || [self.mode isEqualToString:@"print"]) {
        BOOL printing = [self.mode isEqualToString:@"print"];
        NSString *file = [NSTemporaryDirectory() stringByAppendingPathComponent:[NSUUID.UUID.UUIDString stringByAppendingString:@".pdf"]];
        if (!printing) {
            self.printInfo.jobDisposition = NSPrintSaveJob;
            self.printInfo.dictionary[NSPrintJobSavingURL] = [NSURL fileURLWithPath:file];
        }
        self.output=file;
        NSPrintOperation *op = [self.web printOperationWithPrintInfo:self.printInfo]; self.operation=op;
        op.showsPrintPanel = printing; op.showsProgressPanel = printing;
        [op runOperationModalForWindow:(printing ? (NSApp.keyWindow ?: self.window) : self.window) delegate:self didRunSelector:@selector(printOperationDidRun:success:contextInfo:) contextInfo:NULL];
        return;
    }
    [self.web evaluateJavaScript:@"Math.ceil(Math.max(document.documentElement.scrollHeight,document.body.scrollHeight))" completionHandler:^(id value, NSError *error) {
        if (error) { [self finish:nil error:error.localizedDescription]; return; }
        double height = self.requestedHeight > 0 ? self.requestedHeight : [value doubleValue];
        if (height > 30000) { [self finish:nil error:@"文档太长，无法导出为单张图片，请导出为 PDF"]; return; }
        height = MAX(1, height);
        [self.window setContentSize:NSMakeSize(self.requestedWidth, height)];
        self.web.frame = NSMakeRect(0,0,self.requestedWidth,height);
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 120*NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
            WKSnapshotConfiguration *cfg = [WKSnapshotConfiguration new]; cfg.rect = CGRectMake(0,0,self.requestedWidth,height); cfg.snapshotWidth = @(self.requestedWidth);
            [self.web takeSnapshotWithConfiguration:cfg completionHandler:^(NSImage *image, NSError *error) {
                if (error || !image) { [self finish:nil error:error.localizedDescription ?: @"图片导出失败"]; return; }
                NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:(NSInteger)self.requestedWidth pixelsHigh:(NSInteger)height bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
                [NSGraphicsContext saveGraphicsState]; [NSGraphicsContext setCurrentContext:[NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap]];
                [image drawInRect:NSMakeRect(0,0,self.requestedWidth,height)]; [NSGraphicsContext restoreGraphicsState];
                [self finish:[bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}] error:nil];
            }];
        });
    }];
}
@end
void aropyt_render(const char *html, const char *mode, double width, double height, double paperWidth, double paperHeight, double margin, AropytCallback callback, void *context) {
    NSString *body = [NSString stringWithUTF8String:html], *action = [NSString stringWithUTF8String:mode];
    NSRange head=[body rangeOfString:@"<head>" options:NSCaseInsensitiveSearch];
    NSString *policy=@"<meta http-equiv=\"Content-Security-Policy\" content=\"script-src 'none'; object-src 'none'\">";
    body=head.location!=NSNotFound ? [body stringByReplacingCharactersInRange:NSMakeRange(head.location+head.length,0) withString:policy] : [policy stringByAppendingString:body];
    dispatch_async(dispatch_get_main_queue(), ^{
        if (!jobs) jobs = [NSMutableSet new];
        AropytRender *job = [AropytRender new]; job.callback=callback;job.context=context;job.mode=action;job.requestedHeight=height;job.requestedWidth=MAX(1,width);
        job.printInfo = [NSPrintInfo.sharedPrintInfo copy]; job.printInfo.paperSize=NSMakeSize(paperWidth,paperHeight);
        job.printInfo.topMargin=margin;job.printInfo.bottomMargin=margin;job.printInfo.leftMargin=margin;job.printInfo.rightMargin=margin;
        job.printInfo.horizontalPagination=NSPrintingPaginationModeAutomatic;job.printInfo.verticalPagination=NSPrintingPaginationModeAutomatic;job.printInfo.horizontallyCentered=NO;job.printInfo.verticallyCentered=NO;
        WKWebViewConfiguration *cfg=[WKWebViewConfiguration new];cfg.websiteDataStore=WKWebsiteDataStore.nonPersistentDataStore;
        job.web=[[WKWebView alloc] initWithFrame:NSMakeRect(0,0,MAX(1,width),800) configuration:cfg];job.web.navigationDelegate=job;
        job.window=[[NSWindow alloc] initWithContentRect:NSMakeRect(-20000,-20000,MAX(1,width),800) styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
        job.window.releasedWhenClosed=NO;job.window.contentView=job.web;[jobs addObject:job];[job.window orderBack:nil];
        [job.web loadHTMLString:body baseURL:nil];
    });
}
void aropyt_window(void *pointer, const char *action, void *other) {
    NSWindow *win=(__bridge NSWindow *)pointer; NSString *op=[NSString stringWithUTF8String:action];
    dispatch_async(dispatch_get_main_queue(), ^{
        win.tabbingIdentifier=@"aropyt-documents";win.tabbingMode=NSWindowTabbingModePreferred;
        if ([op isEqualToString:@"attach"] && other) [win addTabbedWindow:(__bridge NSWindow *)other ordered:NSWindowAbove];
        else if ([op isEqualToString:@"edited"]) win.documentEdited=YES;
        else if ([op isEqualToString:@"saved"]) win.documentEdited=NO;
        else if ([op isEqualToString:@"emoji"]) [NSApp orderFrontCharacterPalette:nil];
        else if (![op isEqualToString:@"setup"]) {
            SEL selector=NSSelectorFromString([op stringByAppendingString:@":"]);
            if ([win respondsToSelector:selector]) [NSApp sendAction:selector to:win from:nil];
            else if ([NSApp respondsToSelector:selector]) [NSApp sendAction:selector to:NSApp from:nil];
        }
    });
}
