# Checks the GitHub issue forms in .github/ISSUE_TEMPLATE against the rules GitHub applies. A form that breaks one of them
# is dropped from the "New issue" chooser without a message. Run: ruby scripts/check-github-forms.rb
require 'yaml'
$bad = 0
def err(f, m); $bad += 1; puts "ERROR #{f}: #{m}"; end
Dir['.github/ISSUE_TEMPLATE/*.yml'].sort.each do |f|
  d = YAML.safe_load(File.read(f))
  if File.basename(f) == 'config.yml'
    err(f, 'blank_issues_enabled must be true/false') unless [true, false].include?(d['blank_issues_enabled'])
    (d['contact_links'] || []).each { |c| %w[name url about].each { |k| err(f, "contact link missing #{k}") unless c[k].is_a?(String) && !c[k].empty? } }
    puts "ok   #{f} (blank issues #{d['blank_issues_enabled'] ? 'ON' : 'off'}, #{(d['contact_links'] || []).size} links)"
    next
  end
  %w[name description body].each { |k| err(f, "missing #{k}") unless d.key?(k) }
  err(f, 'labels must be strings') if d['labels'] && !d['labels'].all? { |x| x.is_a?(String) }
  ids = {}; fields = 0
  d['body'].each_with_index do |b, i|
    t = b['type']; a = b['attributes'] || {}; w = "body[#{i}] (#{t})"
    unless %w[markdown textarea input dropdown checkboxes].include?(t); err(f, "#{w}: bad type"); next; end
    if t == 'markdown'
      err(f, "#{w}: value required") unless a['value'].is_a?(String) && !a['value'].strip.empty?
      err(f, "#{w}: markdown cannot have validations") if b.key?('validations')
      next
    end
    fields += 1
    err(f, "#{w}: label required") unless a['label'].is_a?(String) && !a['label'].strip.empty?
    if b.key?('id')
      err(f, "#{w}: bad id #{b['id']}") unless b['id'].to_s =~ /\A[A-Za-z0-9_-]+\z/
      err(f, "#{w}: duplicate id #{b['id']}") if ids[b['id']]
      ids[b['id']] = true
    end
    v = b['validations'] || {}
    err(f, "#{w}: required must be true/false") if v.key?('required') && ![true, false].include?(v['required'])
    if t == 'dropdown'
      o = a['options']
      if !o.is_a?(Array) || o.empty? then err(f, "#{w}: options required"); next; end
      o.each { |x| err(f, "#{w}: option #{x.inspect} is #{x.class}, not a String (quote it)") unless x.is_a?(String) }
      err(f, "#{w}: duplicate options") if o.map(&:to_s).uniq.size != o.size
      err(f, "#{w}: \"None\" is a reserved option") if o.include?('None')
    end
    if t == 'checkboxes'
      (a['options'] || []).each do |x|
        err(f, "#{w}: checkbox label must be a String") unless x['label'].is_a?(String)
        err(f, "#{w}: required must be true/false") if x.key?('required') && ![true, false].include?(x['required'])
      end
    end
    err(f, "#{w}: render must be a String") if t == 'textarea' && a.key?('render') && !a['render'].is_a?(String)
  end
  err(f, 'needs at least one input field') if fields.zero?
  puts "ok   #{f} (#{fields} fields, #{ids.size} ids)"
end
puts($bad.zero? ? 'RESULT: all forms valid' : "RESULT: #{$bad} problem(s)")
exit($bad.zero? ? 0 : 1)
