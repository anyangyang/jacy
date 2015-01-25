////////////////////////////////////////
//basic primitives
var UI=require("gui2d/ui");
var W=exports;

UI.DestroyWindow=function(attrs){
	UI.CallIfAvailable(attrs,"OnDestroy");
	if(attrs.is_main_window){
		UI.SDL_PostQuitEvent();
	}
	UI.SDL_DestroyWindow(attrs.hwnd)
};

UI.SetCaret=function(attrs,x,y,w,h,C,dt){
	attrs.caret_x=x;
	attrs.caret_y=y;
	attrs.caret_w=w;
	attrs.caret_h=h;
	attrs.caret_C=C;
	attrs.caret_state=1;
	attrs.caret_dt=dt;
	UI.SDL_SetTextInputRect(x*UI.pixels_per_unit,y*UI.pixels_per_unit,w*UI.pixels_per_unit,h*UI.pixels_per_unit)
};

W.Window=function(id,attrs){
	attrs=UI.Keep(id,attrs);
	//the dpi is not per-inch,
	if(!UI.pixels_per_unit){
		var display_mode=UI.SDL_GetCurrentDisplayMode();
		var design_screen_dim=attrs.designated_screen_size||Math.min(attrs.w,attrs.h)||1600;
		var screen_dim=Math.min(display_mode.w,display_mode.h);
		UI.pixels_per_unit=screen_dim/design_screen_dim;
		UI.ResetRenderer(UI.pixels_per_unit,attrs.gamma||2.2);
		UI.LoadStaticImages(UI.rc);
		//wipe out initialization routines for security
		UI.LoadPackedTexture=null;
		UI.LoadStaticImages=null;
	}
	if(!attrs.hwnd){
		//no default event handler for the window
		attrs.hwnd=UI.SDL_CreateWindow(attrs.title||"untitled",attrs.x||UI.SDL_WINDOWPOS_CENTERED,attrs.y||UI.SDL_WINDOWPOS_CENTERED,attrs.w*UI.pixels_per_unit,attrs.h*UI.pixels_per_unit, attrs.flags);
	}
	//defer the innards painting to the first OnPaint - need the GL context
	attrs.bgcolor=(attrs.bgcolor)
	UI.context_paint_queue.push(attrs);
	UI.HackAllCallbacks(attrs);
	if(UI.context_window_painting){UI.EndPaint();}
	UI.BeginPaint(attrs.hwnd,attrs);
	UI.context_window_painting=1;
	attrs.x=0;
	attrs.y=0;
	return attrs;
}

W.FillRect=function(id,attrs){
	UI.StdAnchoring(id,attrs);
	UI.DrawBitmap(0,attrs.x,attrs.y,attrs.w,attrs.h,attrs.color);
	return attrs;
}

W.Bitmap=function(id,attrs){
	UI.StdAnchoring(id,attrs);
	UI.DrawBitmap(UI.rc[attrs.file]||0,attrs.x,attrs.y,attrs.w||0,attrs.h||0,attrs.color||0xffffffff);
	return attrs;
}

W.Text=function(id,attrs){
	if(!attrs.__layout){UI.LayoutText(attrs);}
	attrs.w=(attrs.w||attrs.w_text);
	attrs.h=(attrs.h||attrs.h_text);
	UI.StdAnchoring(id,attrs);
	UI.DrawTextControl(attrs,attrs.x,attrs.y,attrs.color||0xffffffff)
	return attrs
}

W.RoundRect=function(id,attrs){
	UI.StdAnchoring(id,attrs);
	UI.RoundRect(attrs)
}

/*
*auto-sizing* - "layout current object"
Text(,,TR({}))
TR remembers the "last thing" and the next call fetches its w,h
if(attrs.w)
*/

////////////////////////////////////////
//user input
W.Hotkey=function(id,attrs){
	if(!attrs.action){return;}
	UI.HackCallback(attrs.action);
	UI.context_hotkeys.push(attrs);
	return attrs;
}

W.Region=function(id,attrs){
	//attrs is needed to track OnClick and stuff, *even if we don't store any var*
	attrs=UI.Keep(id,attrs);
	UI.StdAnchoring(id,attrs);
	UI.context_regions.push(attrs);
	return attrs
}

////////////////////////////////////////
//widgets
var Button_prototype={
	OnMouseOver:function(){this.mouse_state="over";UI.Refresh();},
	OnMouseOut:function(){this.mouse_state="out";UI.Refresh();},
	OnMouseDown:function(){this.mouse_state="down";UI.Refresh();},
	OnMouseUp:function(){this.mouse_state="over";UI.Refresh();}
};
W.Button=function(id,attrs0){
	//////////////////
	//styling
	var attrs=UI.Keep(id,attrs0,Button_prototype);
	UI.StdStyling(id,attrs,attrs0, "button",attrs.mouse_state||"out");
	//size estimation
	var bmpid=(UI.rc[attrs.icon]||0);
	if(attrs.w_icon){
		attrs.w_bmp=attrs.w_icon;
		attrs.h_bmp=attrs.h_icon;
	}else{
		UI.GetBitmapSize(bmpid,attrs);
	}
	UI.LayoutText(attrs);
	var padding=(attrs.padding||4);
	attrs.w=(attrs0.w||(attrs.w_bmp+attrs.w_text+padding*2));
	attrs.h=(attrs0.h||(Math.max(attrs.h_bmp,attrs.h_text)+padding*2));
	UI.StdAnchoring(id,attrs);
	//////////////////
	//rendering
	UI.RoundRect(attrs);
	var x=attrs.x+padding;
	if(bmpid)UI.DrawBitmap(bmpid,x,attrs.y+(attrs.h-attrs.h_bmp)*0.5,attrs.w_bmp,attrs.h_bmp,attrs.icon_color||0xffffffff);
	x+=attrs.w_bmp;
	UI.DrawTextControl(attrs,x,attrs.y+(attrs.h-attrs.h_text)*0.5,attrs.text_color||0xffffffff)
	return W.Region(id,attrs);
}

var Edit_prototype={
	caret_width:2,
	caret_color:0xff000000,
	caret_flicker:500,
	color:0xff000000,
	bgcolor_selection:0xffffe0d0,
	OnTextEdit:function(event){
		this.ed.m_IME_overlay=event;
		UI.Refresh()
	},
	OnTextInput:function(event){
		var ed=this.ed;
		var ccnt0=this.sel0.ccnt;
		var ccnt1=this.sel1.ccnt;
		if(ccnt0>ccnt1){var tmp=ccnt1;ccnt1=ccnt0;ccnt0=tmp;}
		ed.MassEdit([ccnt0,ccnt1-ccnt0,event.text])
		var lg=Duktape.__byte_length(event.text);
		this.sel0.ccnt=ccnt0+lg;
		this.sel1.ccnt=ccnt0+lg;
		UI.Refresh()
	},
	OnKeyDown:function(event){
		/*
		implement the baseline here, leave the rest to plugins
			word move
				a general native "MoveTo"
				SnapToCharBoundary
			enhanced home
			copy cut paste
			undo/redo
		*/
		var ed=this.ed;
		var IsKey=UI.IsKey;
		var is_shift=UI.IsModifier(event,["SHIFT"]);
		var epilog=function(){
			if(!is_shift){this.sel0.ccnt=this.sel1.ccnt;}
			//todo: autoscroll
			UI.Refresh();
		};
		//todo: scrolling
		if(0){
		}else if(IsKey(event,["UP"])||IsKey(event,["SHIFT","UP"])){
			var ed_caret=ed.XYFromCcnt(this.sel1.ccnt);
			this.sel1.ccnt=ed.SeekXY(ed_caret.x,ed_caret.y-1.0);
			epilog();
		}else if(IsKey(event,["DOWN"])||IsKey(event,["SHIFT","DOWN"])){
			var hc=ed.GetCharacterHeightAt(this.sel1.ccnt);
			var ed_caret=ed.XYFromCcnt(this.sel1.ccnt);
			this.sel1.ccnt=ed.SeekXY(ed_caret.x,ed_caret.y+hc);
			epilog();
		}else if(IsKey(event,["LEFT"])||IsKey(event,["SHIFT","LEFT"])){
			var ccnt=this.sel1.ccnt;
			if(ccnt>0){
				this.sel1.ccnt=ed.SnapToCharBoundary(ccnt-1,-1);
				epilog();
			}
		}else if(IsKey(event,["RIGHT"])||IsKey(event,["SHIFT","RIGHT"])){
			var ccnt=this.sel1.ccnt;
			if(ccnt<ed.GetTextSize()){
				this.sel1.ccnt=ed.SnapToCharBoundary(ccnt+1,1);
				epilog();
			}
		}else if(IsKey(event,["BACKSPACE"])||IsKey(event,["DELETE"])){
			var ccnt0=this.sel0.ccnt;
			var ccnt1=this.sel1.ccnt;
			if(ccnt0>ccnt1){var tmp=ccnt0;ccnt0=ccnt1;ccnt1=tmp;}
			if(ccnt0==ccnt1){
				if(IsKey(event,["BACKSPACE"])){
					if(ccnt0>0){ccnt0=ed.SnapToCharBoundary(ccnt0-1,-1);}
				}else{
					if(ccnt1<ed.GetTextSize()){ccnt1=ed.SnapToCharBoundary(ccnt1+1,1);}
				}
			}
			if(ccnt0<ccnt1){
				ed.MassEdit([ccnt0,ccnt1-ccnt0,null])
				UI.Refresh();
			}
		}else if(IsKey(event,["CTRL","A"])){
			this.sel0.ccnt=0;
			this.sel1.ccnt=ed.GetTextSize();
			UI.Refresh();
		}else if(IsKey(event,["RETURN"])||IsKey(event,["RETURN2"])){
			//todo: DOS mode test
			this.OnTextInput({"text":"\n"})
		}else if(IsKey(event,["HOME"])||IsKey(event,["SHIFT","HOME"])){
			//todo: enhanced home
			var ed_caret=ed.XYFromCcnt(this.sel1.ccnt);
			this.sel1.ccnt=ed.SeekXY(0,ed_caret.y);
			epilog();
		}else if(IsKey(event,["END"])||IsKey(event,["SHIFT","END"])){
			var ed_caret=ed.XYFromCcnt(this.sel1.ccnt);
			this.sel1.ccnt=ed.SeekXY(1e127,ed_caret.y);
			epilog();
		}else if(IsKey(event,["PAGEUP"])||IsKey(event,["SHIFT","PAGEUP"])){
			var ed_caret=ed.XYFromCcnt(this.sel1.ccnt);
			this.sel1.ccnt=ed.SeekXY(ed_caret.x,ed_caret.y-this.h);
			epilog();
		}else if(IsKey(event,["PAGEDOWN"])||IsKey(event,["SHIFT","PAGEDOWN"])){
			var hc=ed.GetCharacterHeightAt(this.sel1.ccnt);
			var ed_caret=ed.XYFromCcnt(this.sel1.ccnt);
			this.sel1.ccnt=ed.SeekXY(ed_caret.x,ed_caret.y+this.h);
			epilog();
		}else{
		}
	},
};
W.Edit=function(id,attrs0){
	var attrs=UI.Keep(id,attrs0,Edit_prototype);
	UI.StdStyling(id,attrs,attrs0, "edit",attrs.focus_state||"blur");
	UI.StdAnchoring(id,attrs);
	var ed=attrs.ed;
	if(!ed){
		ed=Duktape.__ui_new_editor(attrs);
		if(attrs.text){ed.MassEdit([0,0,code_text]);}
		attrs.sel0=ed.CreateLocator(0,-1);
		attrs.sel1=ed.CreateLocator(0,-1);
		attrs.ed=ed;
		attrs.sel_hl=ed.CreateHighlight(attrs.sel0,attrs.sel1);
		attrs.sel_hl.color=attrs.bgcolor_selection;
		attrs.sel_hl.invertible=1;
		ed.m_caret_locator=attrs.sel1;
	}
	//todo: scrolling
	var scale=(attrs.scale||1);
	var scroll_x=(attrs.scroll_x||0);
	var scroll_y=(attrs.scroll_y||0);
	ed.Render({x:scroll_x,y:scroll_y,w:attrs.w,h:attrs.h, scr_x:attrs.x,scr_y:attrs.y, scale:scale});
	if(UI.HasFocus(attrs)){
		var ed_caret=ed.XYFromCcnt(attrs.sel1.ccnt);
		var x_caret=attrs.x+(ed_caret.x-scroll_x+ed.m_caret_offset)*scale;
		var y_caret=attrs.y+(ed_caret.y-scroll_y)*scale;
		UI.SetCaret(UI.context_window,
			x_caret,y_caret,
			attrs.caret_width*scale,UI.GetFontHeight(attrs.font)*scale,
			attrs.caret_color,attrs.caret_flicker);
	}
	return attrs;
}
