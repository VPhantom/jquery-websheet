/**
 * jQuery Websheet
 *
 * Changes forms into loading an HTML TABLE via AJAX with downloadable
 * spreadsheet link.
 *
 *
 * Basic usage, with default values shown:
 *
 * $('form.websheet').websheet({
 *   init_sort_col: 0,
 *   init_sort_desc: false,  // Thus ascending by default
 *   lang: 'en', // Used for parsing numeric columns
 *   dl_title: "Download spreadsheet version",  // Plain text only
 *   loading: "Loading...",  // Can be any HTML
 *   failed: "An error occured while attempting to load data.",  // Any HTML
 *   callback: null  // See below for usage
 * });
 *
 * Language is English by default, keeping [0-9\.+\-] internally for numeric
 * columns.  Also known is French 'fr' which understands commas AND periods
 * for decimal separation.
 *
 * The matching FORM should also have the following data attributes defined:
 *
 * - data-filename-format should contain a string used as a template for
 * naming the file part of the TABLE's URL (after the last slash).  Any
 * alphanumeric chunk of that string which matches the name of a CGI variable
 * inside the form will be replaced with its value, the rest will be left
 * intact.  Defaults to "table" if left unspecified.  A ".xls" extension will
 * always be appended.
 *
 * - data-source should contain the initial part of the full URL where the
 * TABLE will be downloaded.  (Trailing slash will be added if missing.)
 * Example: https://www.example.com/downloads/sales_report/
 *
 * Websheet will trap attempts to submit the form, and will instead build and
 * fetch in background a URL made of:
 *
 * 1. The contents of data-source;
 * 2. Slash-delimited, sanitized name+':'+value of each non-empty CGI variable
 *    found inside FORM, in order in which they're encountered, excluding
 *    names starting with an underscore ('_');
 * 3. A trailing slash;
 * 4. A file name based on data-filename-format (default: "table");
 * 5. The ".xls" extension.
 *
 * The contents of that URL is expected to be a valid HTML document, but of
 * content-type "application/vnd.ms-excel", containing a TABLE in its BODY.
 * Websheet will look for the first TABLE it finds in it, give it the
 * "websheet" CSS class and append it after the FORM it is associated with.
 *
 * Websheet will also create (or append) the TABLE's CAPTION with a SPAN with
 * CSS class "websheet_download" containing a hyperlink to the same URL
 * containing the specified "dl_title".  Users clicking that link will thus be
 * allowed to download the same document (presumably from the browser's cache)
 * for loading in spreadsheet software.  (This was tested successfully in
 * Excel and LibreOffice.)  Some browsers may suggest incorrect file names if
 * there are CGI variables appended to the URL being saved, hence the
 * compromise to keep values simple enough to fit between slashes in the
 * "PATH_INFO" instead.
 *
 * Note that because we're making the compromise to fit the form's data in a
 * URL, CGI names and values are sanitized.  Specifically, names are reduced
 * to [a-zA-Z0-9] and values are stripped of [:+/#?].
 *
 * Finally, Websheet will replicate each THEAD column's CSS class to each
 * corresponding TBODY cell, which is useful for right-justifying numeric
 * column types, for example.  Suggested class names (will affect sorting
 * algorithm selection):
 *
 * bool   - Whitespace means false, otherwise true
 * number - Float (internally stripped of [^9-0+.\-], so currency is OK)
 * amount - Synonymous with "number" (may be useful in your CSS, etc.)
 * date   - YYYY/MM/DD or YYYY-MM-DD or YYYY.MM.DD
 * text   - String (internally stripped of HTML tags AND ENTITIES)
 *          (Any other class name defaults to 'text' handling as well.)
 *
 * When column headers are clicked, they become the new basis for sorting the
 * TBODY rows.  First, ascending, and if clicked multiple times, toggling
 * between ascending and descending.  The current sorting column header will
 * get CSS class "asc" or "desc" to reflect the current state.
 *
 * If "callback" is defined, it will be invoked every time a new table is
 * downloaded via AJAX just before actually displaying it.  (We use it to make
 * text in certain columns clickable to generate new refined reports.)  It
 * will be passed two jQuery objects as arguments: form and table.  That way
 * you may modify the displayed version of the TABLE and the contents of the
 * FORM (in our case, from within click events on buttons in the displayed
 * TABLE).  You might also want to save Websheet's state here for future use.
 *
 *
 * At any time, Websheet can report its status in response to the 'getState'
 * event, which can then later be fed back to its 'setState' event handler,
 * which expects CGI input/select names as properties of the passed sole
 * argument object, containing the desired values.  Websheet will only
 * consider the properties it (and any input widgets within itself) knows
 * about AND IT WILL REMOVE THEM FROM THE OBJECT.  This helps various widgets
 * coexist.
 *
 * CAUTION: This is NOT the same as jQuery's serializeArray() which returns an
 * array of objects containing 'name' and 'value' properties.  Here we have a
 * single object used more compactly.
 *
 * Websheet takes care of skipping over fields with class '__widget_field' as
 * it overrides input values.  It does, however, bubble down the 'setState'
 * event and data to all its children with class '__widget_form'.  (We use
 * this to have Daterange widgets within Websheet forms.)
 *
 * The 'setState' handler returns TRUE if anything has changed, FALSE
 * otherwise.
 *
 * Example:
 *
 * console.log($('#myWebsheet').triggerHandler('getState));
 * // Object {first: "foo", second: "bar"}
 *
 * // Note jQuery's mandatory [] around our object.
 * // This is required for triggerHandler(), which we need, but not for trigger().
 * // See: http://api.jquery.com/triggerHandler/#triggerHandler-eventType-extraParameters
 * $('#myWebsheet').triggerHandler('setState', [{
 *   first: "foo",
 *   extraneous: "ignored",
 *   second: "bar"
 * }]);
 * // Submits the form (with normal caching) if this constitutes a state change.
 *
 * @package   jquery.websheet
 * @author    Stéphane Lavergne <http://www.imars.com/>
 * @copyright 2013 Stéphane Lavergne
 * @license   http://www.gnu.org/licenses/lgpl-3.0.txt  GNU LGPL version 3
 */

/*jslint node: false, browser: true, es5: false, white: true, nomen: true, plusplus: true, regexp: true */
/*global jQuery: true */

(function ($) {
	"use strict";

	function stringToFloat(src, lang) {
		switch (lang) {
			case 'fr':
				return parseFloat(src.replace(',', '.').replace(/[^0-9\.+\-]/g, ''));
			default:
				return parseFloat(src.replace(/[^0-9\.+\-]/g, ''));
		}
	}

	// Available sort types: bool, number|amount, date, text
	function sortTable(table, colIndex, descending, sortType) {
		// descending is implicitly falsey if unspecified
		// sortType is like 'text' if unspecified

		var rows = [], tbody = $(table).find('tbody');

		tbody.find('tr').each(function () {
			rows.push($(this).detach());
		});

		switch (sortType) {
			case 'bool':
			case 'number':
			case 'amount':
			case 'date':
				rows.sort(function (a, b) {
					return $(a).prop('__data')[colIndex] - $(b).prop('__data')[colIndex];
				});
			break;
			default:
				rows.sort(function (a, b) {
					var
						as = $(a).prop('__data')[colIndex].toUpperCase().toString(),
						bs = $(b).prop('__data')[colIndex].toUpperCase().toString()
					;
					if (as > bs) { return 1;  }
					if (as < bs) { return -1; }
					return 0;
				});
		}

		if (descending) { rows.reverse(); }

		tbody.append(rows);
	}

	$.fn.websheet = function (args) {
		var
			lang           = 'en',
			init_sort_col  = 0,
			init_sort_desc = false,
			dl_title       = 'Download spreadsheet',
			loading        = 'Loading...',
			failed         = 'An error occured while attempting to load data.',
			extension      = '.xls',
			callback       = null,
			nameRegex      = /[^a-zA-Z0-9]+/g,
			valueRegex     = /[:+\/#?]+/g,
			splitter       = /([^a-zA-Z0-9]+)/
		;
		if (args) {
			if (args.lang)           { lang           = args.lang;           }
			if (args.init_sort_col)  { init_sort_col  = args.init_sort_col;  }
			if (args.init_sort_desc) { init_sort_desc = args.init_sort_desc; }
			if (args.dl_title)       { dl_title       = args.dl_title;       }
			if (args.loading)        { loading        = args.loading;        }
			if (args.callback)       { callback       = args.callback;       }
		}

		return this.each(function () {
			var
				form      = $(this),
				format    = form.attr('data-filename-format').split(splitter) || ['table'],
				base_url  = form.attr('data-source'),
				dl_url    = base_url + format + extension,
				div       = $('<div>'),
				hiddens   = $('<span>')
			;
			if (base_url.slice(-1) !== '/') {
				base_url = base_url + '/';
			}
			form.prop('last_submit', {});

			form.append(hiddens);
			form.after(div);
			form.submit(function (ev) {
				var
					fields    = form.serializeArray(),
					fieldsObj = {},
					i         = 0,
					iMax      = format.length
				;
				dl_url = base_url;
				$.each(fields, function (i, field) {
					if (field.value && field.name.substr(0,1) !== '_') {
						dl_url += field.name.replace(nameRegex, '') + ':' + field.value.replace(valueRegex, '') + '/';
					}
					fieldsObj[field.name] = field.value;
				});
				for (i = 0; i < iMax; i++) {
					if (fieldsObj[format[i]] !== undefined) {
						dl_url += fieldsObj[format[i]].replace(valueRegex, '');
					} else {
						dl_url += format[i];
					}
				}
				dl_url += extension;

				div.html(loading);

				$.ajax({
					url: dl_url,
					dataType: 'html',
					processData: false,
					success: function (data, statusText) {
						var
							frag            = $('<div>'),
							table           = null,
							caption         = null,
							classes         = [],
							sort_col        = init_sort_col,
							sort_desc       = init_sort_desc,
							form_sort_col   = form.prop('__websheet_sort_col'),
							form_sort_desc  = form.prop('__websheet_sort_desc'),
							form_sort_title = form.prop('__websheet_sort_title')
						;

						form.prop('last_submit', fieldsObj);
						frag.html(data);
						table = frag.find('table').first().detach();

						div.empty();

						table.addClass('websheet');

						// Add/update CAPTION
						caption = table.find('caption').first().detach();
						if (caption.length === 0) { caption = $('<caption>'); }
						caption.append(' <span class="websheet_download"><a href="'+dl_url+'">'+dl_title+'</a></span>');
						table.prepend(caption);

						// Propagate THEAD classes into TBODY
						// Take note of sanitized/sortable data for each row
						table.find('thead tr').first().children().each(function (i) {
							if (form_sort_col === i && form_sort_title === $(this).text()) {
								sort_col = form_sort_col;
								sort_desc = form_sort_desc;
							}
							var className = $(this).attr('class');
							classes.push(className);
							$(this).click(function (ev) {
								var
									wasInit  = $(this).hasClass(init_sort_desc ? 'desc' : 'asc'),
									newDesc  = (wasInit !== init_sort_desc),
									newOrder = (newDesc ? 'desc' : 'asc')
								;
								table.find('thead tr').first().children().removeClass('asc desc');
								sortTable(table, i, newDesc, className);
								$(this).addClass(newOrder);
								form
									.prop('__websheet_sort_col', i)
									.prop('__websheet_sort_desc', newDesc)
									.prop('__websheet_sort_title', $(this).text())
								;
							});
						});
						table.find('tbody tr').each(function () {
							var data = [];
							$(this).children().each(function (i) {
								var
									cellText = $(this).text(),
									cellValue = 0
								;
								$(this).addClass(classes[i]);
								switch (classes[i]) {
									case 'bool':
										data.push(cellText.trim() !== '');
									break;
									case 'number':
									case 'amount':
										cellValue = stringToFloat(cellText, lang);
										data.push(cellValue);
									break;
									case 'date':
										data.push(new Date(cellText.trim().replace(/[\s\.\-]+/g, '/')));
									break;
									default:
										data.push(cellText.trim());
								}
							});
							$(this).prop('__data', data);
						});

						// Instantiate table in DOM before callback in case it uses
						// before()/after() to add content outside of the table.
						div.append(table);
						if (callback !== null) { callback(form, table); }
						sortTable(table, sort_col, sort_desc, classes[sort_col]);
						table.find('thead tr').first().children().eq(sort_col).addClass(sort_desc ? 'desc' : 'asc');
					},
					error: function (xhr, statusText, err) {
						div.html(failed);
					}
				});

				return false;  // Don't actually submit!
			});


			form.on('setState', function (ev, data) {
				var
					inputs,
					changed = false
				;
				hiddens.empty();
				inputs = $(this).find('select, input');
				inputs.each(function () {
					if (
							!$(this).hasClass('__widget_field')
							&& data[$(this).attr('name')] !== undefined
							&& data[$(this).attr('name')] !== $(this).val()
						) {
						changed = true;
						$(this).val(data[$(this).attr('name')]);
						delete data[$(this).attr('name')];
					}
				});
				$(this).find('.__widget_form').each(function () {
					if ($(this).triggerHandler('setState', data)) {
						changed = true;
					}
				});
				// Any remaining fields get hidden inputs so jQuery can later
				// serialize the form normally.
				$.each(data, function (i) {
						hiddens.append($('<input>').attr({ type: 'hidden', name: i, value: data[i] }));
						changed = true;
				});
				$(this).submit();
				return changed;
			});
			form.on('getState', function (ev, data) {
				return $(this).prop('last_submit');
			});


		});
	};


}( jQuery ));

