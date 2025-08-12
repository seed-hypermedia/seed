# Z-Index Refactoring Plan - Cap at z-50

## New Z-Index Hierarchy (0-50)

### Base Layer (z-0 to z-10)
- `z-0` - Default/base elements
- `z-1` - Slight elevation (avatars, cards)
- `z-2` - Small interactive elements
- `z-3` - Search icons, small overlays
- `z-5` - Media overlays, form placeholders
- `z-9` - Formatting toolbars
- `z-10` - Sidebar elements, navigation helpers

### Intermediate Layer (z-20 to z-30)
- `z-20` - Change items, timeline elements
- `z-30` - Search icons in inputs

### High Priority Layer (z-40 to z-50)
- `z-40` - Fixed bottom bars, notifications
- `z-50` - **MAXIMUM** - Critical overlays, modals, dropdowns

## Required Changes by File

### 1. frontend/packages/ui/src/document-content.tsx
```diff
- className="z-[99999]" // Bubble menu
+ className="z-50"

- className="z-[9999]" // Dev menu  
+ className="z-50"

- className="z-[9999]" // Modal overlay
+ className="z-50"

- className="z-[999]" // Hover state
+ className="z-40"
```

### 2. frontend/packages/editor/src/hm-link-form.tsx  
```diff
- className="z-[99999]" // Search dropdown
+ className="z-50"

- className="z-[99999]" // Link dropdown
+ className="z-50"
```

### 3. frontend/packages/editor/src/autocomplete.tsx
```diff
- className="z-[9999]" // Autocomplete dropdown
+ className="z-50"
```

### 4. frontend/packages/ui/src/site-header.tsx
```diff
- className="z-[999]" // Mobile notification area
+ className="z-40"

- className="z-[800]" // Mobile menu overlay  
+ className="z-40"
```

### 5. frontend/apps/desktop/src/components/titlebar-common.tsx
```diff
- className="z-[900]" // Modal overlay
+ className="z-50"
```

### 6. frontend/apps/desktop/src/components/sidebar-base.tsx
```diff
- className="z-[9999]" // Hover region
+ className="z-40"
```

### 7. frontend/apps/desktop/src/utils/navigation-container.tsx
```diff
- className="z-[1000]" // Dialog container
+ className="z-50"
```

### 8. frontend/packages/editor/src/embed-block.tsx
```diff
- className="z-[999]" // Embed dropdown
+ className="z-50"
```

## Implementation Steps

1. **Update Tailwind Config** (if needed):
   Add custom z-index values to ensure consistency:
   ```js
   // tailwind.config.js
   module.exports = {
     theme: {
       extend: {
         zIndex: {
           '1': '1',
           '2': '2', 
           '3': '3',
           '5': '5',
           '9': '9',
           '40': '40',
           '50': '50'
         }
       }
     }
   }
   ```

2. **Replace in Order of Priority**:
   - Start with the highest values (z-[99999]) first
   - Test each component after changes
   - Work down to lower values

3. **Test Critical Interactions**:
   - Modal overlays should be on top (z-50)
   - Dropdowns should appear above content (z-50) 
   - Tooltips and hover states (z-40)
   - Fixed navigation elements (z-40)

## Validation Checklist

- [ ] All dropdowns appear above other content
- [ ] Modal overlays cover everything
- [ ] No z-index fighting between components
- [ ] Mobile navigation works correctly
- [ ] Editor toolbars and menus function properly
- [ ] Search dropdowns appear correctly
- [ ] Hover states don't get covered

## Benefits

1. **Maintainable**: Clear hierarchy with logical progression
2. **Future-proof**: Room for new components within 0-50 range
3. **Debuggable**: Easy to understand layering relationships
4. **Performance**: Lower z-index values are more efficient

