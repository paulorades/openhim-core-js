'use strict';

var MediatorDetails = React.createClass({
  render: function() {
    return (
      <div >
        <h2><a href={"https://github.com/" + this.props.data.full_name}>{this.props.data.name}</a></h2>
        <p className="lead">{this.props.data.description}</p>
        <a href={"https://github.com/" + this.props.data.full_name + "/releases"} style={{float: "right"}} className="btn btn-default">Download</a>
        <p className="lead">{this.props.data.stargazers_count} <i className="fa fa-star"></i> - written in {this.props.data.language}</p>
        <hr />
      </div>
    );
  }
})

var MediatorList = React.createClass({
  getInitialState: function() {
    return {data: [], spinner: true};
  },
  componentDidMount: function() {
    $.ajax({
      url: this.props.url,
      dataType: 'json',
      cache: false,
      success: function(data) {
        if (data.items && data.items.length > 0) {
          this.setState({data: data.items, spinner: false});
        }
      }.bind(this),
      error: function(xhr, status, err) {
        console.error(this.props.url, status, err.toString());
      }.bind(this)
    });
  },
  render: function() {
    if (this.state.spinner) {
      return (
        <div className="mediators-loading">
          <i className="fa fa-spinner fa-spin"></i>
        </div>
      );
    } else {
      var nodes = this.state.data.map(function (item) {
        return <MediatorDetails data={item} />
      });
      return (
        <div className="mediatorList">
          {nodes}
        </div>
      );
    }
  }
})

ReactDOM.render(
  <MediatorList url="https://api.github.com/search/repositories?q=&quot;openhim-mediator&quot;&sort=stars&order=desc" />,
  document.getElementById('mediator-list-comp')
);
