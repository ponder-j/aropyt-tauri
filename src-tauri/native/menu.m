#import <AppKit/AppKit.h>
#import <objc/runtime.h>

typedef void (*AropytCallback)(void *, const unsigned char *, size_t, const char *);
static char shortcutDelegateKey, shortcutItemKey;

// AppKit draws key equivalents in its own aligned, secondary-text column.
// Renderer-owned shortcuts are exposed only during menu tracking, so closed
// menus cannot intercept editing keys (including Undo and Select All).
@interface AropytShortcutMenuDelegate : NSObject <NSMenuDelegate>
@property(strong) id<NSMenuDelegate> previous;
@property(strong) NSArray<NSDictionary *> *shortcuts;
- (void)setShortcutsVisible:(BOOL)visible;
@end
@implementation AropytShortcutMenuDelegate
- (BOOL)respondsToSelector:(SEL)selector {
    return [super respondsToSelector:selector] || [self.previous respondsToSelector:selector];
}
- (id)forwardingTargetForSelector:(SEL)selector {
    return [self.previous respondsToSelector:selector] ? self.previous : [super forwardingTargetForSelector:selector];
}
- (void)setShortcutsVisible:(BOOL)visible {
    for (NSDictionary *shortcut in self.shortcuts) {
        NSMenuItem *item=shortcut[@"item"];
        if (visible) {
            // Apply modifiers first so a transient bare Q cannot collide with Quit.
            item.keyEquivalentModifierMask=[shortcut[@"modifiers"] unsignedIntegerValue];
            item.keyEquivalent=shortcut[@"key"];
        } else {
            item.keyEquivalent=@"";
            item.keyEquivalentModifierMask=0;
        }
    }
}
- (void)menuWillOpen:(NSMenu *)menu {
    [self setShortcutsVisible:YES];
    if ([self.previous respondsToSelector:_cmd]) [self.previous menuWillOpen:menu];
}
- (void)menuDidClose:(NSMenu *)menu {
    [self setShortcutsVisible:NO];
    if ([self.previous respondsToSelector:_cmd]) [self.previous menuDidClose:menu];
}
@end

static NSString *shortcutKey(NSString *accelerator) {
    NSString *key=[accelerator componentsSeparatedByString:@"+"].lastObject;
    if (key.length==1) return key.lowercaseString;
    if ([key hasPrefix:@"F"]) {
        NSInteger number=[[key substringFromIndex:1] integerValue];
        if (number>=1 && number<=24) {
            unichar character=NSF1FunctionKey+number-1;
            return [NSString stringWithCharacters:&character length:1];
        }
    }
    return @{@"Backspace":@"\b",@"Delete":@"\177",@"Enter":@"\r",@"Tab":@"\t",@"Space":@" "}[key] ?: @"";
}

static void installHints(NSMenu *menu, NSArray *entries) {
    NSMutableArray *shortcuts=[NSMutableArray new];
    for (NSUInteger index=0;index<MIN(entries.count,(NSUInteger)menu.numberOfItems);index++) {
        NSDictionary *entry=entries[index]; NSMenuItem *item=[menu itemAtIndex:index];
        if ([entry[@"submenu"] isKindOfClass:NSArray.class]) {
            if (item.submenu) installHints(item.submenu,entry[@"submenu"]);
            continue;
        }
        NSString *accelerator=entry[@"accelerator"];
        if (![accelerator isKindOfClass:NSString.class] || !accelerator.length) continue;
        // These predefined items already use the Cocoa responder chain.
        if ([@[@"cut",@"copy",@"paste",@"services"] containsObject:entry[@"role"] ?: @""]) continue;
        BOOL displayOnly=[entry[@"registerAccelerator"] isEqual:@NO] ||
            [@[@"Ctrl+A",@"CommandOrControl+A"] containsObject:accelerator];
        if (!displayOnly) continue;
        // AppKit can clear a conflicting equivalent while a menu is installed.
        // Recover its display hint from the immutable template in that case.
        NSString *key=item.keyEquivalent.length ? item.keyEquivalent : shortcutKey(accelerator);
        NSDictionary *shortcut=@{@"item":item,@"key":key,@"modifiers":@(item.keyEquivalentModifierMask)};
        [shortcuts addObject:shortcut];
        objc_setAssociatedObject(item,&shortcutItemKey,@YES,OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }
    if (!shortcuts.count) return;
    AropytShortcutMenuDelegate *delegate=[AropytShortcutMenuDelegate new];
    delegate.previous=menu.delegate; delegate.shortcuts=shortcuts;
    // NSMenu holds its delegate weakly; retaining it on the menu also releases
    // it when a language/theme refresh replaces that menu.
    objc_setAssociatedObject(menu,&shortcutDelegateKey,delegate,OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    menu.delegate=delegate; [delegate setShortcutsVisible:NO];
}

void aropyt_menu_hints(const char *json) {
    NSData *data=[[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding];
    NSArray *entries=[NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
    void (^install)(void)=^{ installHints(NSApp.mainMenu,entries); };
    if (NSThread.isMainThread) install(); else dispatch_sync(dispatch_get_main_queue(),install);
}

static NSArray *snapshot(NSMenu *menu, BOOL preview) {
    AropytShortcutMenuDelegate *delegate=objc_getAssociatedObject(menu,&shortcutDelegateKey);
    if (preview) [delegate setShortcutsVisible:YES];
    NSMutableArray *items=[NSMutableArray new];
    for (NSMenuItem *item in menu.itemArray) {
        NSMutableDictionary *value=[@{@"label":item.title,@"key":item.keyEquivalent,
            @"modifiers":@(item.keyEquivalentModifierMask),@"displayOnly":@(objc_getAssociatedObject(item,&shortcutItemKey)!=nil)} mutableCopy];
        if (item.submenu) value[@"submenu"]=snapshot(item.submenu,preview);
        [items addObject:value];
    }
    if (preview) [delegate setShortcutsVisible:NO];
    return items;
}

// Used only by the opt-in loopback harness, never by a normal app command.
void aropyt_menu_snapshot(BOOL preview, AropytCallback callback, void *context) {
    dispatch_async(dispatch_get_main_queue(),^{
        NSData *data=[NSJSONSerialization dataWithJSONObject:snapshot(NSApp.mainMenu,preview) options:0 error:NULL];
        callback(context,data.bytes,data.length,NULL);
    });
}
